'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ShieldPawIcon } from '@/components/Logo';

type StepDetail = {
    textEs: string;
    textEn: string;
    linkUrl?: string;
    linkTextEs?: string;
    linkTextEn?: string;
};

type GuideStep = {
    slug: string;
    entry: {
        title: string;
        titleEs: string;
        titleEn: string;
        descriptionEs: string;
        descriptionEn: string;
        icon: string;
        order: number;
        details?: StepDetail[];
    };
};

type BenefitItem = {
    slug: string;
    entry: {
        icon: string;
        textEs: string;
        textEn: string;
        order: number;
    };
};

type HeroData = {
    titleEs: string;
    titleEn: string;
    subtitleEs: string;
    subtitleEn: string;
    ctaTextEs: string;
    ctaTextEn: string;
    ctaUrl: string;
};

type LabelsData = {
    processHeaderEs: string;
    processHeaderEn: string;
    stepPrefixEs: string;
    stepPrefixEn: string;
    whyVetEs: string;
    whyVetEn: string;
    faqHeaderEs: string;
    faqHeaderEn: string;
    ctaButtonEs: string;
    ctaButtonEn: string;
};

// Phase color scheme — each phase gets its own accent
const PHASE_COLORS = [
    { bg: 'bg-teal-50', border: 'border-teal-200', accent: 'bg-teal-500', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800', ring: 'ring-teal-200', iconBg: 'bg-teal-100' },
    { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', ring: 'ring-amber-200', iconBg: 'bg-amber-100' },
    { bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-500', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-800', ring: 'ring-violet-200', iconBg: 'bg-violet-100' },
    { bg: 'bg-rose-50', border: 'border-rose-200', accent: 'bg-rose-500', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800', ring: 'ring-rose-200', iconBg: 'bg-rose-100' },
    { bg: 'bg-blue-50', border: 'border-blue-200', accent: 'bg-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', ring: 'ring-blue-200', iconBg: 'bg-blue-100' },
    { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-200', iconBg: 'bg-emerald-100' },
];

export default function GuiaPage() {
    const { locale, t } = useLanguage();
    const { data: session } = useSession();

    const isEnglish = locale === 'en';

    const [steps, setSteps] = useState<GuideStep[]>([]);
    const [benefits, setBenefits] = useState<BenefitItem[]>([]);
    const [hero, setHero] = useState<HeroData | null>(null);
    const [labels, setLabels] = useState<LabelsData | null>(null);

    // Fetch all content from API
    useEffect(() => {
        fetch('/api/guide-content')
            .then((res) => res.json() as Promise<{ steps?: GuideStep[]; benefits?: BenefitItem[]; hero?: HeroData; labels?: LabelsData }>)
            .then((data) => {
                setSteps(data.steps || []);
                setBenefits(data.benefits || []);
                setHero(data.hero || null);
                setLabels(data.labels || null);
            })
            .catch((err) => console.error('[Guide] Failed to load content:', err));
    }, [session]);

    const pick = <T,>(es: T, en: T) => (isEnglish ? en : es);

    const label = (esKey: keyof LabelsData, enKey: keyof LabelsData, fallbackEs: string, fallbackEn: string) =>
        labels ? pick(labels[esKey] as string, labels[enKey] as string) : pick(fallbackEs, fallbackEn);

    const sortedSteps = steps.sort((a, b) => a.entry.order - b.entry.order);

    return (
        <main className="min-h-screen bg-stone-50">
            {/* Hero Section — full-width gradient header */}
            <header className="relative overflow-hidden bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 text-white py-16 md:py-24 px-4">
                <div className="absolute inset-0 opacity-10" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 75%, white 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                }} />
                <div className="relative max-w-3xl mx-auto text-center space-y-5">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm mb-2">
                        <ShieldPawIcon className="w-10 h-10" />
                    </div>
                    <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">
                        {hero ? pick(hero.titleEs, hero.titleEn) : pick('Guía Completa de Adopción Responsable', 'Complete Responsible Adoption Guide')}
                    </h1>
                    <p className="text-teal-100 text-lg md:text-xl max-w-2xl mx-auto font-medium leading-relaxed">
                        {hero ? pick(hero.subtitleEs, hero.subtitleEn) : pick(
                            '6 fases para garantizar que cada animal llegue al hogar correcto — y se quede ahí',
                            '6 phases to ensure every animal reaches the right home — and stays there'
                        )}
                    </p>
                    {/* Quick jump pills */}
                    {sortedSteps.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-2 pt-4">
                            {sortedSteps.map((step, i) => (
                                <button
                                    key={step.slug}
                                    onClick={() => document.getElementById(`phase-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-all hover:scale-105"
                                >
                                    <span>{step.entry.icon}</span>
                                    <span className="hidden sm:inline">{pick(step.entry.titleEs, step.entry.titleEn).replace(/^Fase \d+:\s*/, '').replace(/^Phase \d+:\s*/, '').split('(')[0].trim()}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            <div className="max-w-3xl mx-auto px-4 py-12 space-y-16">
                {/* Phase Timeline — All phases expanded with full details */}
                {sortedSteps.length > 0 && (
                    <section className="space-y-2">
                        <h2 className="text-sm font-bold text-stone-400 uppercase tracking-widest text-center mb-8">
                            {label('processHeaderEs', 'processHeaderEn', 'Las 6 Fases', 'The 6 Phases')}
                        </h2>
                        <div className="relative">
                            {/* Vertical timeline connector */}
                            <div className="absolute left-5 md:left-7 top-0 bottom-0 w-0.5 bg-gradient-to-b from-teal-300 via-violet-300 to-emerald-300 rounded-full" />

                            <div className="space-y-6">
                                {sortedSteps.map((step, i) => {
                                    const colors = PHASE_COLORS[i % PHASE_COLORS.length];
                                    const details = step.entry.details || [];

                                    return (
                                        <div key={step.slug} id={`phase-${i}`} className="relative scroll-mt-20">
                                            {/* Timeline dot */}
                                            <div className={`absolute left-3 md:left-5 top-6 w-5 h-5 rounded-full ${colors.accent} ring-4 ${colors.ring} ring-offset-2 ring-offset-stone-50 z-10 shadow-sm`} />

                                            {/* Phase card — always expanded */}
                                            <div className={`ml-14 md:ml-16 rounded-2xl border ${colors.border} bg-white shadow-sm overflow-hidden`}>
                                                {/* Header */}
                                                <div className="px-5 py-5 md:px-6 md:py-6 flex items-start gap-4">
                                                    <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${colors.iconBg} flex items-center justify-center text-2xl shadow-sm`}>
                                                        {step.entry.icon}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>
                                                                {label('stepPrefixEs', 'stepPrefixEn', 'Fase', 'Phase')} {i + 1}
                                                            </span>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-stone-900 mb-1 leading-snug">
                                                            {pick(step.entry.titleEs, step.entry.titleEn)}
                                                        </h3>
                                                        <p className="text-stone-500 text-sm leading-relaxed">
                                                            {pick(step.entry.descriptionEs, step.entry.descriptionEn)}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Details — always visible */}
                                                {details.length > 0 && (
                                                    <div className={`px-5 pb-5 md:px-6 md:pb-6 border-t ${colors.border}`}>
                                                        <ul className="space-y-3 pt-4">
                                                            {details.map((detail, j) => (
                                                                <li key={j} className="flex items-start gap-3">
                                                                    <span className={`flex-shrink-0 w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-xs font-bold mt-0.5`}>
                                                                        {j + 1}
                                                                    </span>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-stone-700 text-sm leading-relaxed">
                                                                            {pick(detail.textEs, detail.textEn)}
                                                                        </p>
                                                                        {detail.linkUrl && (
                                                                            <Link
                                                                                href={detail.linkUrl}
                                                                                className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-xs font-bold ${colors.badge} hover:opacity-80 transition-opacity shadow-sm`}
                                                                            >
                                                                                {pick(detail.linkTextEs || detail.linkUrl, detail.linkTextEn || detail.linkUrl)}
                                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                                                            </Link>
                                                                        )}
                                                                    </div>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                )}

                {/* Why Vetting Matters */}
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:p-8">
                    <h2 className="text-xl font-bold text-stone-900 mb-6 text-center">
                        {label('whyVetEs', 'whyVetEn', '¿Por qué verificar adoptantes?', 'Why Vet Adopters?')}
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {benefits.length > 0
                            ? benefits
                                .sort((a, b) => a.entry.order - b.entry.order)
                                .map((item) => (
                                    <div key={item.slug} className="flex gap-3 items-start p-3 rounded-xl bg-stone-50 hover:bg-teal-50 transition-colors group">
                                        <span className="text-xl flex-shrink-0 group-hover:scale-110 transition-transform">{item.entry.icon}</span>
                                        <p className="text-stone-600 text-sm font-medium">{pick(item.entry.textEs, item.entry.textEn)}</p>
                                    </div>
                                ))
                            : [
                                { icon: '🛡️', es: 'Protege a los animales de adopciones irresponsables', en: 'Protect animals from irresponsible adoptions' },
                                { icon: '🤝', es: 'Construye confianza en la comunidad de rescate', en: 'Build trust in the rescue community' },
                                { icon: '📋', es: 'Mantiene un historial compartido entre refugios', en: 'Maintain shared history across shelters' },
                                { icon: '⚠️', es: 'Alerta sobre adoptantes con advertencias previas', en: 'Flag adopters with previous warnings' },
                            ].map((item, i) => (
                                <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-stone-50">
                                    <span className="text-xl flex-shrink-0">{item.icon}</span>
                                    <p className="text-stone-600 text-sm font-medium">{pick(item.es, item.en)}</p>
                                </div>
                            ))
                        }
                    </div>
                </section>

                {/* CTA + FAQ link */}
                <section className="text-center space-y-5 py-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-50 mb-1">
                        <span className="text-3xl">🐾</span>
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        {hero ? pick(hero.ctaTextEs, hero.ctaTextEn) : pick('¿Listo para empezar?', 'Ready to start?')}
                    </h2>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link
                            href={hero?.ctaUrl || '/'}
                            className="inline-flex items-center gap-2 bg-teal-600 text-white px-8 py-3.5 rounded-xl font-bold hover:bg-teal-700 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 transform"
                        >
                            {label('ctaButtonEs', 'ctaButtonEn', 'Empezar a Verificar', 'Start Vetting')} →
                        </Link>
                        <Link
                            href="/guia/faq"
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-all"
                        >
                            {label('faqHeaderEs', 'faqHeaderEn', 'Preguntas Frecuentes', 'FAQ')} →
                        </Link>
                    </div>
                </section>

                {/* Back link */}
                <div className="text-center pb-8">
                    <Link
                        href="/"
                        className="text-stone-400 hover:text-stone-600 text-sm underline underline-offset-2 transition-colors"
                    >
                        ← {t('nav.back_to_search')}
                    </Link>
                </div>
            </div>
        </main>
    );
}
