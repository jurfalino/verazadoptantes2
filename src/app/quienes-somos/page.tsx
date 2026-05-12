'use client';

import { useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { ShieldPawIcon } from '@/components/Logo';

/**
 * Editorial "Quiénes Somos" page — long-form story about the project's
 * origin, the three pillars, and the mission. Linked from the global footer.
 * Locale-aware via the `about.*` i18n namespace; the URL stays `/quienes-somos`
 * regardless of locale (Spanish-anchored brand).
 */
function useScrollReveal() {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animate-in');
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -80px 0px' }
        );
        el.querySelectorAll('.reveal,.reveal-stagger').forEach((child) => observer.observe(child));
        return () => observer.disconnect();
    }, []);
    return ref;
}

function PillarIconRegistry({ className = 'w-7 h-7' }: { className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V7M4 7l8-4 8 4M4 7h16M9 11h6M9 15h6" />
        </svg>
    );
}

function PillarIconFollowUp({ className = 'w-7 h-7' }: { className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    );
}

function PillarIconAlert({ className = 'w-7 h-7' }: { className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
    );
}

export default function QuienesSomosPage() {
    const { t } = useLanguage();
    const containerRef = useScrollReveal();

    const pillars = [
        { Icon: PillarIconRegistry, title: t('about.pillar1_title'), desc: t('about.pillar1_desc'), tone: 'teal' as const },
        { Icon: PillarIconFollowUp, title: t('about.pillar2_title'), desc: t('about.pillar2_desc'), tone: 'amber' as const },
        { Icon: PillarIconAlert,    title: t('about.pillar3_title'), desc: t('about.pillar3_desc'), tone: 'rose'  as const },
    ];

    const tones = {
        teal:  { bg: 'bg-teal-100',  text: 'text-teal-700',  ring: 'ring-teal-200/60'  },
        amber: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' },
        rose:  { bg: 'bg-rose-100',  text: 'text-rose-700',  ring: 'ring-rose-200/60'  },
    };

    return (
        <main ref={containerRef} className="min-h-screen bg-stone-50">
            <style>{`
                .reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1); }
                .reveal.animate-in { opacity: 1; transform: translateY(0); }
                .reveal-stagger { opacity: 0; transform: translateY(28px); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }
                .reveal-stagger.animate-in { opacity: 1; transform: translateY(0); }
                .reveal-stagger:nth-child(1) { transition-delay: 0s; }
                .reveal-stagger:nth-child(2) { transition-delay: 0.12s; }
                .reveal-stagger:nth-child(3) { transition-delay: 0.24s; }

                /* Hero entrance */
                .hero-stagger { opacity: 0; transform: translateY(24px); animation: heroFadeUp 0.8s cubic-bezier(0.16,1,0.3,1) forwards; }
                .hero-stagger:nth-child(1) { animation-delay: 0.05s; }
                .hero-stagger:nth-child(2) { animation-delay: 0.18s; }
                .hero-stagger:nth-child(3) { animation-delay: 0.32s; }
                .hero-stagger:nth-child(4) { animation-delay: 0.48s; }
                @keyframes heroFadeUp { to { opacity: 1; transform: translateY(0); } }

                /* Soft hero radial backdrop */
                .hero-backdrop {
                    background:
                        radial-gradient(ellipse 80% 50% at 50% 0%, rgba(13,148,136,0.10), transparent 70%),
                        linear-gradient(180deg, #f5f5f4 0%, #fafaf9 100%);
                }

                @media (prefers-reduced-motion: reduce) {
                    .reveal, .reveal-stagger, .hero-stagger { opacity: 1 !important; transform: none !important; animation: none !important; }
                }
            `}</style>

            {/* ── Hero ───────────────────────────────────────────── */}
            <section className="hero-backdrop relative overflow-hidden">
                <div className="max-w-3xl mx-auto px-4 pt-20 pb-20 sm:pt-28 sm:pb-24 text-center">
                    <div className="hero-stagger inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 mb-6">
                        <ShieldPawIcon className="w-9 h-9" />
                    </div>
                    <div className="hero-stagger text-xs font-bold tracking-[0.2em] uppercase text-teal-700 mb-3">
                        {t('about.hero_eyebrow')}
                    </div>
                    <h1 className="hero-stagger text-4xl sm:text-5xl md:text-6xl font-bold text-stone-900 leading-[1.1] tracking-tight mb-6">
                        {t('about.hero_title')}
                    </h1>
                    <div className="hero-stagger max-w-2xl mx-auto space-y-4">
                        <p className="text-base sm:text-lg text-stone-600 leading-relaxed">
                            {t('about.hero_lead')}
                        </p>
                        <p className="text-base sm:text-lg font-semibold text-stone-800 leading-relaxed">
                            {t('about.hero_subline')}
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Our Story ──────────────────────────────────────── */}
            <section className="py-16 sm:py-20 px-4">
                <div className="max-w-2xl mx-auto">
                    <div className="reveal flex items-center gap-3 mb-6">
                        <div className="w-10 h-px bg-teal-600" />
                        <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-teal-700">
                            {t('about.story_title')}
                        </h2>
                    </div>
                    <div className="reveal space-y-5 text-stone-700 text-base sm:text-lg leading-[1.75]">
                        <p>{t('about.story_p1')}</p>
                        <p>{t('about.story_p2')}</p>
                    </div>
                </div>
            </section>

            {/* ── The Project ────────────────────────────────────── */}
            <section className="py-16 sm:py-20 px-4 bg-white border-y border-stone-200">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-12">
                        <div className="reveal text-xs font-bold tracking-[0.2em] uppercase text-teal-700 mb-3">
                            {t('about.project_title')}
                        </div>
                        <p className="reveal max-w-2xl mx-auto text-stone-700 text-base sm:text-lg leading-relaxed">
                            {t('about.project_intro')}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {pillars.map(({ Icon, title, desc, tone }) => {
                            const c = tones[tone];
                            return (
                                <div
                                    key={title}
                                    className={`reveal-stagger group p-6 rounded-2xl bg-stone-50 border border-stone-200 hover:border-stone-300 hover:shadow-md transition-all`}
                                >
                                    <div className={`w-12 h-12 rounded-xl ${c.bg} ${c.text} ring-4 ${c.ring} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <h3 className="text-lg font-bold text-stone-900 mb-2">{title}</h3>
                                    <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ── Our Mission ────────────────────────────────────── */}
            <section className="py-16 sm:py-20 px-4">
                <div className="max-w-3xl mx-auto">
                    <div className="reveal relative rounded-3xl bg-gradient-to-br from-teal-50 via-white to-teal-50 border border-teal-100 p-8 sm:p-12 text-center shadow-sm">
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-teal-600 text-white text-xs font-bold tracking-[0.2em] uppercase shadow-md">
                            {t('about.mission_title')}
                        </div>
                        <p className="text-stone-800 text-lg sm:text-xl leading-[1.7] mt-4">
                            {t('about.mission_body')}
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Pull Quote ─────────────────────────────────────── */}
            <section className="py-12 sm:py-16 px-4">
                <div className="max-w-3xl mx-auto text-center">
                    <div className="reveal">
                        <span className="block text-7xl sm:text-8xl leading-none text-teal-200 font-serif select-none" aria-hidden>“</span>
                        <blockquote className="-mt-6 text-xl sm:text-2xl italic text-stone-700 leading-[1.5] font-light">
                            {t('about.quote')}
                        </blockquote>
                    </div>
                </div>
            </section>

            {/* ── Closing + Signature ────────────────────────────── */}
            <section className="py-12 sm:py-16 px-4 pb-20">
                <div className="max-w-2xl mx-auto text-center">
                    <p className="reveal text-stone-700 text-base sm:text-lg leading-relaxed mb-10">
                        {t('about.closing')}
                    </p>
                    <div className="reveal flex flex-col items-center gap-1">
                        <div className="w-12 h-px bg-stone-300 mb-4" />
                        <div className="text-base font-bold text-stone-900 tracking-tight">
                            {t('about.founders')}
                        </div>
                        <div className="text-xs font-semibold tracking-[0.2em] uppercase text-stone-500">
                            {t('about.founders_role')}
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
