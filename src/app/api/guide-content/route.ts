import { NextResponse } from 'next/server';

export const runtime = 'edge';

// Static content — managed via Keystatic CMS in local dev,
// served as static data in production (edge runtime has no fs access).
const STEPS = [
    {
        slug: 'registrar',
        entry: {
            title: 'Registrar',
            titleEs: 'Registrar al adoptante',
            titleEn: 'Register the adopter',
            descriptionEs: 'Ingrese los datos del adoptante para iniciar el proceso de verificación.',
            descriptionEn: 'Enter the adopter\'s information to start the vetting process.',
            icon: '📝',
            order: 1,
        },
    },
    {
        slug: 'calificar',
        entry: {
            title: 'Calificar',
            titleEs: 'Calificar al adoptante',
            titleEn: 'Rate the adopter',
            descriptionEs: 'Evalúe al adoptante según su experiencia y observaciones.',
            descriptionEn: 'Rate the adopter based on your experience and observations.',
            icon: '⭐',
            order: 2,
        },
    },
    {
        slug: 'buscar',
        entry: {
            title: 'Buscar',
            titleEs: 'Buscar historial',
            titleEn: 'Search history',
            descriptionEs: 'Consulte el historial del adoptante antes de entregar a un animal.',
            descriptionEn: 'Check the adopter\'s history before handing over an animal.',
            icon: '🔍',
            order: 3,
        },
    },
];

const FAQ = [
    {
        slug: 'que-es-verificar',
        entry: {
            question: '¿Qué es verificar adoptantes?',
            questionEs: '¿Qué es verificar adoptantes?',
            questionEn: 'What is adopter vetting?',
            answerEs: 'La verificación de adoptantes es el proceso de consultar referencias e historial antes de entregar un animal a un nuevo hogar.',
            answerEn: 'Adopter vetting is the process of checking references and history before placing an animal in a new home.',
            order: 1,
        },
    },
    {
        slug: 'como-empiezo',
        entry: {
            question: '¿Cómo empiezo?',
            questionEs: '¿Cómo empiezo a usar la plataforma?',
            questionEn: 'How do I get started?',
            answerEs: 'Registrate con tu cuenta de Google y empezá a buscar o registrar adoptantes de inmediato.',
            answerEn: 'Sign up with your Google account and start searching or registering adopters right away.',
            order: 2,
        },
    },
    {
        slug: 'es-gratis',
        entry: {
            question: '¿Es gratis?',
            questionEs: '¿La plataforma es gratuita?',
            questionEn: 'Is it free?',
            answerEs: 'Sí, la plataforma es completamente gratuita para rescatistas y refugios.',
            answerEn: 'Yes, the platform is completely free for rescuers and shelters.',
            order: 3,
        },
    },
];

const HERO = {
    titleEs: 'Guía del Proceso de Adopción',
    titleEn: 'Adoption Process Guide',
    subtitleEs: 'Todo lo que necesitás saber sobre adopción responsable de mascotas',
    subtitleEn: 'Everything you need to know about responsible pet adoption',
    ctaTextEs: '¿Listo para empezar?',
    ctaTextEn: 'Ready to start?',
    ctaUrl: '/',
};

const BENEFITS = [
    {
        slug: 'protect',
        entry: {
            icon: '🛡️',
            textEs: 'Protege a los animales de adopciones irresponsables',
            textEn: 'Protect animals from irresponsible adoptions',
            order: 1,
        },
    },
    {
        slug: 'trust',
        entry: {
            icon: '🤝',
            textEs: 'Construye confianza en la comunidad de rescate',
            textEn: 'Build trust in the rescue community',
            order: 2,
        },
    },
    {
        slug: 'history',
        entry: {
            icon: '📋',
            textEs: 'Mantiene un historial compartido entre refugios',
            textEn: 'Maintain shared history across shelters',
            order: 3,
        },
    },
    {
        slug: 'alert',
        entry: {
            icon: '⚠️',
            textEs: 'Alerta sobre adoptantes con advertencias previas',
            textEn: 'Flag adopters with previous warnings',
            order: 4,
        },
    },
];

const LABELS = {
    processHeaderEs: 'El Proceso',
    processHeaderEn: 'The Process',
    stepPrefixEs: 'Paso',
    stepPrefixEn: 'Step',
    whyVetEs: '¿Por qué verificar adoptantes?',
    whyVetEn: 'Why Vet Adopters?',
    faqHeaderEs: 'Preguntas Frecuentes',
    faqHeaderEn: 'Frequently Asked Questions',
    ctaButtonEs: 'Empezar a Verificar',
    ctaButtonEn: 'Start Vetting',
};

export async function GET() {
    return NextResponse.json({ steps: STEPS, faq: FAQ, hero: HERO, benefits: BENEFITS, labels: LABELS });
}
