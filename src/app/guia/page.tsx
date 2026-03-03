'use client';

import { useLanguage } from '@/context/LanguageContext';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ShieldPawIcon } from '@/components/Logo';

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
    };
};

type FaqItem = {
    slug: string;
    entry: {
        question: string;
        questionEs: string;
        questionEn: string;
        answerEs: string;
        answerEn: string;
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

export default function GuiaPage() {
    const { locale, t } = useLanguage();
    const pathname = usePathname();
    const { data: session } = useSession();

    const isEnglish = pathname.startsWith('/guide') || locale === 'en';
    const [isAdmin, setIsAdmin] = useState(false);

    const [steps, setSteps] = useState<GuideStep[]>([]);
    const [faq, setFaq] = useState<FaqItem[]>([]);
    const [hero, setHero] = useState<HeroData | null>(null);
    const [expandedFaq, setExpandedFaq] = useState<string | null>(null);

    // Fetch content from API
    useEffect(() => {
        fetch('/api/guide-content')
            .then((res) => res.json())
            .then((data) => {
                const d = data as { steps: GuideStep[]; faq: FaqItem[]; hero: HeroData };
                setSteps(d.steps);
                setFaq(d.faq);
                setHero(d.hero);
            })
            .catch((err) => console.error('[Guide] Failed to load content:', err));

        // Check admin status
        if (session?.user?.email) {
            fetch('/api/admin/config')
                .then(res => { if (res.ok) setIsAdmin(true); })
                .catch(() => { });
        }
    }, [session]);

    const pick = <T,>(es: T, en: T) => (isEnglish ? en : es);

    return (
        <main className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-3xl mx-auto space-y-12">
                {/* Hero Section */}
                <header className="text-center space-y-4">
                    {isAdmin && (
                        <Link
                            href="/admin"
                            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 bg-teal-50 px-3 py-1 rounded-full hover:bg-teal-100 transition-colors mb-2"
                        >
                            ⚙️ Admin
                        </Link>
                    )}
                    <ShieldPawIcon className="w-14 h-14 mx-auto mb-2" />
                    <h1 className="text-4xl md:text-5xl font-extrabold text-stone-900 tracking-tight">
                        {hero ? pick(hero.titleEs, hero.titleEn) : (isEnglish ? 'Adoption Process Guide' : 'Guía del Proceso de Adopción')}
                    </h1>
                    <p className="text-stone-600 text-lg max-w-xl mx-auto font-medium">
                        {hero ? pick(hero.subtitleEs, hero.subtitleEn) : (isEnglish
                            ? 'Everything you need to know about responsible pet adoption'
                            : 'Todo lo que necesitás saber sobre adopción responsable de mascotas'
                        )}
                    </p>
                </header>

                {/* Process Steps */}
                {steps.length > 0 && (
                    <section className="space-y-6">
                        <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider text-center">
                            {isEnglish ? 'The Process' : 'El Proceso'}
                        </h2>
                        <div className="grid gap-4 md:grid-cols-3">
                            {steps
                                .sort((a, b) => a.entry.order - b.entry.order)
                                .map((step, i) => (
                                    <div
                                        key={step.slug}
                                        className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 text-center hover:shadow-md hover:border-teal-200 transition-all group"
                                    >
                                        <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl group-hover:scale-110 transition-transform">
                                            {step.entry.icon}
                                        </div>
                                        <div className="text-xs font-bold text-teal-600 mb-1">
                                            {isEnglish ? `Step ${i + 1}` : `Paso ${i + 1}`}
                                        </div>
                                        <h3 className="text-lg font-bold text-stone-900 mb-2">
                                            {pick(step.entry.titleEs, step.entry.titleEn)}
                                        </h3>
                                        <p className="text-stone-500 text-sm leading-relaxed">
                                            {pick(step.entry.descriptionEs, step.entry.descriptionEn)}
                                        </p>
                                    </div>
                                ))}
                        </div>
                    </section>
                )}

                {/* Why Vetting Matters */}
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:p-8">
                    <h2 className="text-xl font-bold text-stone-900 mb-4 text-center">
                        {isEnglish ? 'Why Vet Adopters?' : '¿Por qué verificar adoptantes?'}
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {[
                            {
                                icon: '🛡️',
                                es: 'Protege a los animales de adopciones irresponsables',
                                en: 'Protect animals from irresponsible adoptions',
                            },
                            {
                                icon: '🤝',
                                es: 'Construye confianza en la comunidad de rescate',
                                en: 'Build trust in the rescue community',
                            },
                            {
                                icon: '📋',
                                es: 'Mantiene un historial compartido entre refugios',
                                en: 'Maintain shared history across shelters',
                            },
                            {
                                icon: '⚠️',
                                es: 'Alerta sobre adoptantes con advertencias previas',
                                en: 'Flag adopters with previous warnings',
                            },
                        ].map((item, i) => (
                            <div key={i} className="flex gap-3 items-start">
                                <span className="text-xl flex-shrink-0">{item.icon}</span>
                                <p className="text-stone-600 text-sm">{pick(item.es, item.en)}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* FAQ */}
                {faq.length > 0 && (
                    <section className="space-y-4">
                        <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider text-center">
                            {isEnglish ? 'Frequently Asked Questions' : 'Preguntas Frecuentes'}
                        </h2>
                        <div className="space-y-3">
                            {faq
                                .sort((a, b) => a.entry.order - b.entry.order)
                                .map((item) => (
                                    <div
                                        key={item.slug}
                                        className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden"
                                    >
                                        <button
                                            onClick={() => setExpandedFaq(expandedFaq === item.slug ? null : item.slug)}
                                            className="w-full px-5 py-4 text-left flex items-center justify-between gap-2 hover:bg-stone-50 transition-colors"
                                        >
                                            <span className="font-semibold text-stone-900 text-sm">
                                                {pick(item.entry.questionEs, item.entry.questionEn)}
                                            </span>
                                            <span
                                                className={`text-stone-400 transition-transform ${expandedFaq === item.slug ? 'rotate-180' : ''
                                                    }`}
                                            >
                                                ▾
                                            </span>
                                        </button>
                                        {expandedFaq === item.slug && (
                                            <div className="px-5 pb-4 text-stone-600 text-sm leading-relaxed border-t border-stone-100 pt-3">
                                                {pick(item.entry.answerEs, item.entry.answerEn)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </section>
                )}

                {/* CTA */}
                <section className="text-center space-y-4 py-8">
                    <h2 className="text-2xl font-bold text-stone-900">
                        {hero ? pick(hero.ctaTextEs, hero.ctaTextEn) : (isEnglish ? 'Ready to start?' : '¿Listo para empezar?')}
                    </h2>
                    <Link
                        href={hero?.ctaUrl || '/'}
                        className="inline-flex items-center gap-2 bg-teal-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-teal-700 transition-colors shadow-sm hover:shadow-md"
                    >
                        {isEnglish ? 'Start Vetting' : 'Empezar a Verificar'} →
                    </Link>
                </section>

                {/* Back link */}
                <div className="text-center">
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
