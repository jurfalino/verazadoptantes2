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
    /**
     * One level of sub-points, no deeper. Phases 3 to 5 read as "do this, and
     * here is what that involves", which a flat list turned into a run of
     * equal-weight instructions. `**bold**` inside any text renders as bold —
     * this copy is static and authored here, never user input.
     */
    children?: StepDetail[];
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

/** FAQ category keys — labels are localized in the i18n `faq.category.*`
 *  namespace, not stored here. Display order is defined by the FAQ page. */
export type FaqCategory = 'about' | 'privacy' | 'getting-started' | 'process';

export type FaqEntry = {
    question: string;
    questionEs: string;
    questionEn: string;
    questionPt: string;
    answerEs: string;
    answerEn: string;
    answerPt: string;
    /** Groups the entry under a category section on /faq. */
    category: FaqCategory;
    /** Sort order within its category. */
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
                    textEs: 'Salud al día: desparasitación interna y externa.',
                    textEn: 'Health up to date: internal and external deworming.',
                    textPt: 'Saúde em dia: vermifugação interna e externa.',
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
            titleEs: 'Fase 3: El Filtro (Investigación de los candidatos)',
            titleEn: 'Phase 3: The Filter (Researching the Candidates)',
            titlePt: 'Fase 3: O Filtro (Investigação dos candidatos)',
            descriptionEs: '',
            descriptionEn: '',
            descriptionPt: '',
            icon: '🔍',
            order: 3,
            details: [
                {
                    textEs: 'Como primer paso se recomienda **recabar información** de los interesados:',
                    textEn: 'As a first step, **gather information** about the people interested:',
                    textPt: 'Como primeiro passo, recomenda-se **reunir informações** sobre os interessados:',
                    children: [
                        {
                            textEs: 'Se puede hacer con un formulario, una entrevista telefónica, ó ambos (lo recomendado).',
                            textEn: 'You can use a form, a phone interview, or both (recommended).',
                            textPt: 'Pode ser com um formulário, uma entrevista por telefone, ou ambos (o recomendado).',
                        },
                        {
                            textEs: 'Referencias: podés pedir el contacto del veterinario de su mascota anterior o actual.',
                            textEn: 'References: you can ask for the contact of the vet who saw their previous or current pet.',
                            textPt: 'Referências: você pode pedir o contato do veterinário do pet anterior ou atual.',
                        },
                    ],
                },
                {
                    textEs: 'Luego debés **verificar los datos**:',
                    textEn: 'Then you have to **verify what they told you**:',
                    textPt: 'Depois você deve **verificar os dados**:',
                    children: [
                        {
                            textEs: 'Buscá el nombre en Google y redes sociales.',
                            textEn: 'Search the name on Google and social media.',
                            textPt: 'Busque o nome no Google e nas redes sociais.',
                        },
                        {
                            textEs: 'Verificá los antecedentes —y registralos— en Buen Adoptante.',
                            textEn: 'Check their history — and record it — on Buen Adoptante.',
                            textPt: 'Verifique os antecedentes — e registre-os — no Buen Adoptante.',
                            linkUrl: '/',
                            linkTextEs: '🔎 Buscar en Buen Adoptante',
                            linkTextEn: '🔎 Search on Buen Adoptante',
                            linkTextPt: '🔎 Buscar no Buen Adoptante',
                        },
                    ],
                },
            ],
        },
    },
    {
        slug: 'entrevista-visita',
        entry: {
            title: 'Entrevista presencial',
            titleEs: 'Fase 4: La Entrevista presencial',
            titleEn: 'Phase 4: The In-Person Meeting',
            titlePt: 'Fase 4: A Entrevista presencial',
            descriptionEs: '',
            descriptionEn: '',
            descriptionPt: '',
            icon: '🏠',
            order: 4,
            details: [
                {
                    textEs: 'Es recomendable invitar a los interesados a conocer al animal en tu casa.',
                    textEn: 'Invite the people interested to meet the animal at your home.',
                    textPt: 'É recomendável convidar os interessados para conhecer o animal na sua casa.',
                    children: [
                        {
                            textEs: 'Te permite conocer mejor al interesado y entablar una relación para que sea más ameno el seguimiento.',
                            textEn: 'It lets you get to know them better and build a rapport that makes the follow-up easier.',
                            textPt: 'Permite conhecê-los melhor e criar um vínculo que torna o acompanhamento mais leve.',
                        },
                        {
                            textEs: 'Si el adoptante tiene otro animal o un niño, pedile que lo lleve, para observar cómo interactúan con el animal.',
                            textEn: 'If they have another pet or a child, ask them to bring them along, so you can see how they interact with the animal.',
                            textPt: 'Se o adotante tiver outro animal ou uma criança, peça que leve, para observar como interagem com o animal.',
                        },
                    ],
                },
            ],
        },
    },
    {
        slug: 'contrato-entrega',
        entry: {
            title: 'Entrega y Contrato',
            titleEs: 'Fase 5: La Entrega y El Contrato',
            titleEn: 'Phase 5: The Handover and the Contract',
            titlePt: 'Fase 5: A Entrega e o Contrato',
            descriptionEs: 'Las adopciones se entregan SOLO en el domicilio del adoptante:',
            descriptionEn: 'Animals are handed over ONLY at the adopter\'s home:',
            descriptionPt: 'As adoções são entregues SOMENTE no domicílio do adotante:',
            icon: '📋',
            order: 5,
            details: [
                {
                    textEs: 'Esto te permite verificar la dirección real y observar dónde va a vivir.',
                    textEn: 'This lets you confirm the real address and see where the animal will live.',
                    textPt: 'Isso permite verificar o endereço real e observar onde o animal vai viver.',
                    children: [
                        {
                            textEs: 'Detectar si hay peligros (balcones sin red, cercos bajos, suciedad extrema) y si te dijeron la verdad en relación a los detalles de la vivienda.',
                            textEn: 'Spot hazards (balconies without nets, low fences, extreme dirt) and whether they told you the truth about the home.',
                            textPt: 'Detectar perigos (sacadas sem tela, cercas baixas, sujeira extrema) e se disseram a verdade sobre a moradia.',
                        },
                        {
                            textEs: 'Por ejemplo, si no tienen la comida, el collar/chapa o las piedras sanitarias antes de que el animal llegue, no es una buena señal.',
                            textEn: 'For example, if the food, collar/tag or litter are not ready before the animal arrives, that is not a good sign.',
                            textPt: 'Por exemplo, se a comida, a coleira/plaquinha ou a areia não estiverem prontas antes de o animal chegar, não é um bom sinal.',
                        },
                        {
                            textEs: 'También observar cómo se desenvuelve el animal, y la familia, y brindarles asistencia para asegurar una pronta adaptación.',
                            textEn: 'Also watch how the animal and the family settle in, and help them so the adaptation goes quickly.',
                            textPt: 'Observe também como o animal e a família se adaptam, e ofereça ajuda para que a adaptação seja rápida.',
                        },
                    ],
                },
                {
                    textEs: 'El momento del traspaso debe ser formal para que el adoptante sienta el peso de la responsabilidad.',
                    textEn: 'The handover moment must be formal so the adopter feels the weight of the responsibility.',
                    textPt: 'O momento da entrega deve ser formal para que o adotante sinta o peso da responsabilidade.',
                    children: [
                        {
                            textEs: 'Verificá el documento del adoptante y la firma de un **Contrato de Adopción Responsable** impreso o digital.',
                            textEn: 'Check the adopter\'s ID and the signature on a **Responsible Adoption Contract**, printed or digital.',
                            textPt: 'Verifique o documento do adotante e a assinatura de um **Contrato de Adoção Responsável**, impresso ou digital.',
                        },
                    ],
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
            descriptionEs: 'El trabajo no termina cuando entregás el animal.',
            descriptionEn: 'The work does not end when you hand the animal over.',
            descriptionPt: 'O trabalho não termina quando você entrega o animal.',
            icon: '📞',
            order: 6,
            details: [
                {
                    textEs: 'Día 1: ¿Cómo pasó la noche?',
                    textEn: 'Day 1: How did the night go?',
                    textPt: 'Dia 1: Como foi a noite?',
                },
                {
                    textEs: 'Semana 1: ¿Hubo algún problema de adaptación?',
                    textEn: 'Week 1: Were there any adaptation issues?',
                    textPt: 'Semana 1: Houve algum problema de adaptação?',
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
    // ── Sobre BuenAdoptante ──
    {
        slug: 'que-es-buenadoptante',
        entry: {
            question: '¿Qué es BuenAdoptante y de qué me sirve?',
            questionEs: '¿Qué es BuenAdoptante y de qué me sirve?',
            questionEn: 'What is BuenAdoptante and how does it help me?',
            questionPt: 'O que é o BuenAdoptante e para que serve?',
            answerEs: '- Es un **registro centralizado de adopciones**.\n- Cada vez que tengas que entregar un animal en tránsito o adopción, podés buscar los datos de la persona que lo recibe: si otro rescatista ya le dio otro animal y lo cargó al registro, vas a ver la fecha, la calificación y los comentarios que haya dejado, para ayudarte a evaluar la situación.\n- BuenAdoptante **no es una lista de malos adoptantes**. Porque cuando alguien se da cuenta de que a una persona no se le puede confiar la vida de un animal, ya suele ser tarde.\n- Las herramientas de evaluación tradicionales suelen resultar insuficientes: la facilidad y la convicción con la que pueden mentir ciertos individuos —un rasgo a menudo vinculado a la psicopatía— dificultan detectar intenciones ocultas.\n- Ante esta realidad, BuenAdoptante surge como una alternativa para compartir datos fácticos que ayudan a evaluar si a una persona se le puede confiar una vida.',
            answerEn: '- It is a **centralized registry of adoptions**.\n- Whenever you are about to place an animal — in foster or adoption — you can look up the person receiving it: if another rescuer already gave them an animal and logged it, you will see the date, the rating, and any comments they left, to help you assess the situation.\n- BuenAdoptante is **not a blacklist of bad adopters**. Because by the time someone realizes a person cannot be trusted with an animal\'s life, it is usually already too late.\n- Traditional screening methods often fall short: the ease and conviction with which certain individuals lie — a trait often linked to psychopathy — make hidden intentions hard to detect.\n- Faced with that reality, BuenAdoptante offers an alternative: sharing factual data that helps evaluate whether a person can be trusted with a life.',
            answerPt: '- É um **registro centralizado de adoções**.\n- Toda vez que você for entregar um animal — em lar temporário ou adoção — pode buscar os dados da pessoa que vai recebê-lo: se outro resgatista já deu um animal a ela e registrou, você verá a data, a avaliação e os comentários que tenha deixado, para ajudar a avaliar a situação.\n- O BuenAdoptante **não é uma lista de maus adotantes**. Porque, quando alguém percebe que não se pode confiar a vida de um animal a uma pessoa, geralmente já é tarde.\n- As ferramentas de avaliação tradicionais costumam ser insuficientes: a facilidade e a convicção com que certos indivíduos mentem — um traço muitas vezes ligado à psicopatia — dificultam detectar intenções ocultas.\n- Diante dessa realidade, o BuenAdoptante surge como uma alternativa para compartilhar dados factuais que ajudam a avaliar se a uma pessoa se pode confiar uma vida.',
            category: 'about',
            order: 1,
        },
    },
    {
        slug: 'como-evaluar',
        entry: {
            question: '¿Cómo evaluar a un adoptante?',
            questionEs: '¿Cómo evaluar a un adoptante?',
            questionEn: 'How do I evaluate an adopter?',
            questionPt: 'Como avaliar um adotante?',
            answerEs: '- La comunicación telefónica o en persona es siempre recomendable —aunque no infalible— si se hace de forma metódica y aprendés a leer las evasivas y omisiones.\n- BuenAdoptante no reemplaza tu proceso de evaluación, pero suma una herramienta poderosa: conocer las experiencias previas de otros rescatistas con la persona que estás evaluando.\n- **Valoraciones**: podés valorar cada interacción con un adoptante de 1 a 5 estrellas. Es un dato objetivo que además podés acompañar con una descripción de lo ocurrido.\n- **Alertas**: el sistema genera alertas automáticas si detecta que una persona está intentando adoptar una cantidad no habitual de animales en un período de tiempo.',
            answerEn: '- Talking on the phone or in person is always advisable — though not foolproof — if you do it methodically and learn to read evasions and omissions.\n- BuenAdoptante does not replace your evaluation process, but it adds a powerful tool: seeing other rescuers\' prior experiences with the person you are assessing.\n- **Ratings**: you can rate each interaction with an adopter from 1 to 5 stars. It is objective data that you can also pair with a description of what happened.\n- **Alerts**: the system automatically raises an alert if it detects that a person is trying to adopt an unusual number of animals within a period of time.',
            answerPt: '- A comunicação por telefone ou pessoalmente é sempre recomendável — embora não infalível — se for feita de forma metódica e você aprender a ler as evasivas e omissões.\n- O BuenAdoptante não substitui o seu processo de avaliação, mas acrescenta uma ferramenta poderosa: conhecer as experiências prévias de outros resgatistas com a pessoa que você está avaliando.\n- **Avaliações**: você pode avaliar cada interação com um adotante de 1 a 5 estrelas. É um dado objetivo que também pode acompanhar com uma descrição do que aconteceu.\n- **Alertas**: o sistema gera alertas automáticos se detectar que uma pessoa está tentando adotar uma quantidade incomum de animais em um período de tempo.',
            category: 'about',
            order: 2,
        },
    },
    {
        slug: 'que-es-verificar',
        entry: {
            question: '¿Qué significa "verificar" un adoptante?',
            questionEs: '¿Qué significa "verificar" un adoptante?',
            questionEn: 'What does it mean to "vet" an adopter?',
            questionPt: 'O que significa "verificar" um adotante?',
            answerEs: 'La verificación de adoptantes es el proceso de consultar referencias e historial antes de entregar un animal a un nuevo hogar. Permite detectar personas con antecedentes de maltrato o adopciones irresponsables.',
            answerEn: 'Adopter vetting is the process of checking references and history before placing an animal in a new home. It helps detect people with a history of abuse or irresponsible adoptions.',
            answerPt: 'Verificar adotantes é o processo de consultar referências e histórico antes de entregar um animal a um novo lar. Permite detectar pessoas com antecedentes de maus-tratos ou adoções irresponsáveis.',
            category: 'about',
            order: 3,
        },
    },
    {
        slug: 'es-gratis',
        entry: {
            question: '¿La plataforma es gratuita?',
            questionEs: '¿La plataforma es gratuita?',
            questionEn: 'Is the platform free?',
            questionPt: 'A plataforma é gratuita?',
            answerEs: 'Sí, la plataforma es gratuita para rescatistas y refugios.',
            answerEn: 'Yes, the platform is free for rescuers and shelters.',
            answerPt: 'Sim, a plataforma é gratuita para resgatistas e abrigos.',
            category: 'about',
            order: 4,
        },
    },
    // ── Privacidad y datos ──
    {
        slug: 'es-seguro',
        entry: {
            question: '¿Es seguro para mí y para los adoptantes?',
            questionEs: '¿Es seguro para mí y para los adoptantes?',
            questionEn: 'Is it secure for me and for adopters?',
            questionPt: 'É seguro para mim e para os adotantes?',
            answerEs: 'Sí. La plataforma es completamente segura:\n- **Cifrado**: la comunicación entre tu dispositivo y el servidor está encriptada (HTTPS), así como los datos que se guardan.\n- **Adoptantes**: sus datos de contacto quedan enmascarados y solo los ve quien tiene acceso.\n- **Rescatistas**: la comunidad solo ve tu nombre o alias —que podés cambiar fácilmente en Configuración—, no tu email.',
            answerEn: 'Yes. The platform is fully secure:\n- **Encryption**: the connection between your device and the server is encrypted (HTTPS), and so is the stored data.\n- **Adopters**: their contact details are masked and only seen by people with access.\n- **Rescuers**: the community only sees your name or alias — which you can easily change in Settings — not your email.',
            answerPt: 'Sim. A plataforma é completamente segura:\n- **Criptografia**: a comunicação entre o seu dispositivo e o servidor é criptografada (HTTPS), assim como os dados armazenados.\n- **Adotantes**: seus dados de contato ficam ocultos e só são vistos por quem tem acesso.\n- **Resgatistas**: a comunidade só vê o seu nome ou alias — que você pode alterar facilmente nas Configurações —, não seu e-mail.',
            category: 'privacy',
            order: 1,
        },
    },
    {
        slug: 'protege-informacion',
        entry: {
            question: '¿Cómo se protege la información de los adoptantes?',
            questionEs: '¿Cómo se protege la información de los adoptantes?',
            questionEn: 'How is adopters\' information protected?',
            questionPt: 'Como as informações dos adotantes são protegidas?',
            answerEs: '- Todos los registros que se cargan a mano están **Protegidos**: los datos de contacto (teléfono, email, dirección) quedan enmascarados y solo son visibles para el responsable del registro (y otros miembros de su organización, si los hubiera).\n- El **nombre** y la **localidad** de la dirección se mantienen visibles para facilitar la identificación, sin exponer información privada.\n- La excepción son las redes sociales: por defecto, la información que se carga desde ellas se considera **pública** y queda visible para todos los usuarios.',
            answerEn: '- Every record entered by hand is **Protected**: contact details (phone, email, address) are masked and visible only to the record\'s owner (and their organization teammates, if any).\n- The **name** and the address **locality** stay visible to make identification easier, without exposing private information.\n- The exception is social media: by default, information imported from it is considered **public** and stays visible to everyone.',
            answerPt: '- Todo registro inserido manualmente é **Protegido**: os dados de contato (telefone, e-mail, endereço) ficam ocultos e visíveis apenas para o responsável pelo registro (e outros membros da sua organização, se houver).\n- O **nome** e a **localidade** do endereço permanecem visíveis para facilitar a identificação, sem expor informações privadas.\n- A exceção são as redes sociais: por padrão, a informação carregada a partir delas é considerada **pública** e fica visível para todos os usuários.',
            category: 'privacy',
            order: 2,
        },
    },
    {
        slug: 'quien-puede-ver',
        entry: {
            question: '¿Quién puede ver los datos que registro?',
            questionEs: '¿Quién puede ver los datos que registro?',
            questionEn: 'Who can see the data I record?',
            questionPt: 'Quem pode ver os dados que eu registro?',
            answerEs: 'Pueden ver los datos de contacto:\n- Vos, el responsable del registro.\n- Tus compañeros de organización.\n- Los administradores y moderadores.\n- Cualquier persona a la que le otorgues acceso.\nEl resto ve el registro como **Protegido**, con los datos de contacto ocultos. La actividad de adopción — calificación e historial — sí es visible para la comunidad, porque es el corazón de la verificación; lo que se protege son los datos de contacto personales.',
            answerEn: 'The people who can see contact details are:\n- You, the record\'s owner.\n- Your organization teammates.\n- Admins and moderators.\n- Anyone you grant access to.\nEveryone else sees the record as **Protected**, with contact details hidden. Adoption activity — rating and history — is visible to the community, because that is the heart of vetting; what stays protected is the personal contact information.',
            answerPt: 'Podem ver os dados de contato:\n- Você, o responsável pelo registro.\n- Seus colegas de organização.\n- Os administradores e moderadores.\n- Qualquer pessoa a quem você conceda acesso.\nOs demais veem o registro como **Protegido**, com os dados de contato ocultos. A atividade de adoção — avaliação e histórico — é visível para a comunidade, pois é o cerne da verificação; o que fica protegido são os dados de contato pessoais.',
            category: 'privacy',
            order: 3,
        },
    },
    {
        slug: 'acceso-protegido',
        entry: {
            question: '¿Cómo accedo a un dato protegido?',
            questionEs: '¿Cómo accedo a un dato protegido?',
            questionEn: 'How do I access a protected detail?',
            questionPt: 'Como acesso um dado protegido?',
            answerEs: 'Tenés dos maneras:\n- Podés verificar un dato que ya tenés: si buscás por nombre y teléfono y el sistema encuentra un registro que coincide, te muestra el resultado con el teléfono visible. Lo mismo con una dirección o una red social.\n- Si encontrás un registro por nombre, al abrirlo vas a ver qué información de contacto tiene cargada; estará enmascarada, y si querés validar algún dato —por ejemplo un teléfono— podés ingresar el que vos conocés: si concuerda, el sistema te lo confirma.\n- Por último, si no tenés información del adoptante pero tenés un interés genuino, podés solicitar acceso al responsable del registro explicando el motivo; el responsable recibe tu solicitud y decide si te lo otorga.',
            answerEn: 'There are two ways:\n- You can verify a detail you already have: if you search by name and phone and the system finds a matching record, it shows you the result with the phone visible. The same goes for an address or a social profile.\n- If you find a record by name, opening it shows you what contact information it has on file; it will be masked, and if you want to validate a detail — a phone number, say — you can enter the one you know: if it matches, the system confirms it.\n- Finally, if you have no information about the adopter but a genuine interest, you can request access from the record\'s owner, explaining your reason; the owner receives your request and decides whether to grant it.',
            answerPt: 'Você tem duas maneiras:\n- Pode verificar um dado que já tem: se buscar por nome e telefone e o sistema encontrar um registro que coincide, ele mostra o resultado com o telefone visível. O mesmo vale para um endereço ou uma rede social.\n- Se encontrar um registro por nome, ao abri-lo você verá quais informações de contato ele tem cadastradas; estarão ocultas, e se quiser validar algum dado — um telefone, por exemplo — pode inserir o que você conhece: se coincidir, o sistema confirma.\n- Por fim, se não tem informação do adotante mas tem um interesse genuíno, pode solicitar acesso ao responsável pelo registro explicando o motivo; o responsável recebe seu pedido e decide se concede.',
            category: 'privacy',
            order: 4,
        },
    },
    // ── Cómo empezar ──
    {
        slug: 'como-empiezo',
        entry: {
            question: '¿Cómo empiezo a usar la plataforma?',
            questionEs: '¿Cómo empiezo a usar la plataforma?',
            questionEn: 'How do I get started?',
            questionPt: 'Como eu começo a usar a plataforma?',
            answerEs: 'Registrate con tu cuenta de Google y empezá a buscar o registrar adoptantes de inmediato. La plataforma pide autenticación (con Google) para dejar registro de quién ingresa o modifica información, y también para asentar la aceptación de los términos y condiciones, que —en resumen— indican que cada usuario es responsable de la información que ingresa y que esta debe ser fehaciente.',
            answerEn: 'Sign up with your Google account and start searching or registering adopters right away. The platform requires authentication (via Google) to keep a record of who enters or edits information, and also to register acceptance of the terms and conditions, which — in short — state that each user is responsible for the information they enter and that it must be truthful.',
            answerPt: 'Cadastre-se com sua conta do Google e comece a buscar ou registrar adotantes na hora. A plataforma pede autenticação (via Google) para manter um registro de quem insere ou modifica informações, e também para registrar a aceitação dos termos e condições, que — em resumo — indicam que cada usuário é responsável pela informação que insere e que ela deve ser fidedigna.',
            category: 'getting-started',
            order: 1,
        },
    },
    {
        slug: 'registrar-buscar',
        entry: {
            question: '¿Cómo registro o busco un adoptante?',
            questionEs: '¿Cómo registro o busco un adoptante?',
            questionEn: 'How do I register or search for an adopter?',
            questionPt: 'Como registro ou busco um adotante?',
            answerEs: 'Desde la pantalla principal, buscá por nombre, teléfono o email. Si el adoptante ya existe, vas a ver su perfil con su calificación e historial; si no, podés crearlo en segundos y empezar a registrar su actividad. Cualquier rescatista puede sumar información a un perfil existente.',
            answerEn: 'From the home screen, search by name, phone, or email. If the adopter already exists, you\'ll see their profile with their rating and history; if not, you can create it in seconds and start logging their activity. Any rescuer can add information to an existing profile.',
            answerPt: 'Na tela inicial, busque por nome, telefone ou e-mail. Se o adotante já existir, você verá o perfil com a avaliação e o histórico; se não, você pode criá-lo em segundos e começar a registrar a atividade. Qualquer resgatista pode acrescentar informações a um perfil existente.',
            category: 'getting-started',
            order: 2,
        },
    },
    {
        slug: 'instalar-app',
        entry: {
            question: '¿Necesito instalar una app?',
            questionEs: '¿Necesito instalar una app?',
            questionEn: 'Do I need to install an app?',
            questionPt: 'Preciso instalar um aplicativo?',
            answerEs: 'No. BuenAdoptante funciona en el navegador de tu celular o computadora. Si querés, podés instalarla como app desde el navegador para acceder más rápido, pero no es obligatorio.',
            answerEn: 'No. BuenAdoptante works in your phone or computer browser. If you want, you can install it as an app from the browser for quicker access, but it is not required.',
            answerPt: 'Não. O BuenAdoptante funciona no navegador do seu celular ou computador. Se quiser, pode instalá-lo como aplicativo pelo navegador para acessar mais rápido, mas não é obrigatório.',
            category: 'getting-started',
            order: 3,
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
