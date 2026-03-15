'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { ShieldPawIcon } from '@/components/Logo';

/* ── Features with real screenshots ────────────────────────── */

const FEATURES = [
    { key: 'search',    img: '/images/features/profile.png' },
    { key: 'import',    img: '/images/features/import.png' },
    { key: 'dashboard', img: '/images/features/dashboard.png' },
    { key: 'orgs',      img: '/images/features/organizations.png' },
] as const;

/* ── Scroll reveal ────────────────────────────────────────── */

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
            { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
        );
        el.querySelectorAll('.reveal').forEach((child) => observer.observe(child));
        return () => observer.disconnect();
    }, []);
    return ref;
}

/* ── Page ────────────────────────────────────────────────── */

export default function FuncionalidadesPage() {
    const { t } = useLanguage();
    const containerRef = useScrollReveal();

    return (
        <main ref={containerRef} className="min-h-screen bg-stone-50">
            <style>{`
                .reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }
                .reveal.animate-in { opacity: 1; transform: translateY(0); }
                .screenshot-frame { box-shadow: 0 25px 60px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05); }
            `}</style>

            {/* ═══ HERO ═══ */}
            <header className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-stone-900 text-white">
                <div className="absolute inset-0 opacity-[0.04]" style={{
                    backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                }} />
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-stone-50 to-transparent" />

                <div className="relative max-w-5xl mx-auto px-4 pt-20 pb-28 md:pt-28 md:pb-36 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 mb-8">
                        <ShieldPawIcon className="w-4 h-4" />
                        <span className="text-xs font-semibold tracking-wide uppercase">BuenAdoptante</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08] max-w-3xl mx-auto">
                        {t('features.hero_title')}
                    </h1>
                    <p className="text-teal-200/90 text-lg md:text-xl max-w-2xl mx-auto mt-6 leading-relaxed font-medium">
                        {t('features.hero_subtitle')}
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 mt-10">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 bg-white text-teal-800 px-7 py-3.5 rounded-xl font-bold hover:bg-teal-50 transition-all shadow-lg shadow-black/15 hover:-translate-y-0.5 transform text-sm"
                        >
                            {t('features.hero_cta')}
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        </Link>
                        <Link
                            href="/guia"
                            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-white/80 bg-white/10 hover:bg-white/15 backdrop-blur-sm border border-white/10 transition-all text-sm"
                        >
                            {t('features.hero_cta_guide')}
                        </Link>
                    </div>
                </div>
            </header>

            {/* ═══ PAIN POINTS ═══ */}
            <section className="relative -mt-14 z-10 max-w-4xl mx-auto px-4">
                <div className="reveal grid md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="bg-white rounded-2xl border border-stone-200 shadow-lg overflow-hidden group hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                            <div className="px-5 py-4 border-b border-stone-100 bg-stone-50/80">
                                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-stone-400">{t('features.before_label')}</span>
                                <p className="text-stone-500 text-[13px] mt-1.5 leading-relaxed">{t(`features.pain${n}_before`)}</p>
                            </div>
                            <div className="px-5 py-4 bg-gradient-to-b from-white to-teal-50/30">
                                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-teal-600">{t('features.after_label')}</span>
                                <p className="text-stone-900 text-[13px] mt-1.5 leading-relaxed font-semibold">{t(`features.pain${n}_after`)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ═══ FEATURE SECTIONS ═══ */}
            <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 space-y-32 md:space-y-40">

                {FEATURES.map((feat, i) => {
                    const isReversed = i % 2 === 1;

                    return (
                        <section
                            key={feat.key}
                            className={`reveal grid lg:grid-cols-2 gap-12 lg:gap-20 items-center`}
                        >
                            {/* Screenshot */}
                            <div className={isReversed ? 'lg:order-2' : ''}>
                                <div className="screenshot-frame rounded-2xl overflow-hidden bg-stone-200 ring-1 ring-stone-300/50">
                                    {/* Fake browser chrome */}
                                    <div className="bg-stone-100 border-b border-stone-200 px-4 py-2.5 flex items-center gap-2">
                                        <div className="flex gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
                                        </div>
                                        <div className="flex-1 bg-white rounded-md px-3 py-1 text-[10px] text-stone-400 font-mono ml-2 truncate">
                                            buenadoptante.com
                                        </div>
                                    </div>
                                    <Image
                                        src={feat.img}
                                        alt={t(`features.feat_${feat.key}_title`)}
                                        width={700}
                                        height={440}
                                        className="w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Copy */}
                            <div className={`space-y-5 ${isReversed ? 'lg:order-1' : ''}`}>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-100">
                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                    <span className="text-xs font-bold text-teal-700 uppercase tracking-wider">
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                </div>
                                <h2 className="text-2xl md:text-3xl lg:text-[2.2rem] font-extrabold text-stone-900 tracking-tight leading-tight">
                                    {t(`features.feat_${feat.key}_title`)}
                                </h2>
                                <p className="text-stone-500 text-base md:text-lg leading-relaxed max-w-lg">
                                    {t(`features.feat_${feat.key}_desc`)}
                                </p>
                            </div>
                        </section>
                    );
                })}
            </div>

            {/* ═══ TRUST SIGNALS ═══ */}
            <section className="border-y border-stone-200 bg-white">
                <div className="max-w-4xl mx-auto px-4 py-14 md:py-16">
                    <div className="reveal grid grid-cols-2 md:grid-cols-4 gap-8">
                        {([
                            { key: 'free',      icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
                            { key: 'privacy',   icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
                            { key: 'mobile',    icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
                            { key: 'bilingual', icon: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129' },
                        ] as const).map(({ key, icon }) => (
                            <div key={key} className="text-center group">
                                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-center group-hover:bg-teal-50 group-hover:border-teal-100 transition-colors">
                                    <svg className="w-5 h-5 text-stone-400 group-hover:text-teal-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
                                    </svg>
                                </div>
                                <p className="text-sm font-semibold text-stone-700">{t(`features.trust_${key}`)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══ FINAL CTA ═══ */}
            <section className="max-w-2xl mx-auto px-4 py-24 md:py-28 text-center">
                <div className="reveal space-y-6">
                    <ShieldPawIcon className="w-12 h-12 mx-auto" />
                    <h2 className="text-3xl md:text-4xl font-extrabold text-stone-900 tracking-tight">
                        {t('features.final_cta')}
                    </h2>
                    <p className="text-stone-500 text-base max-w-md mx-auto">{t('features.hero_subtitle')}</p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 bg-teal-700 text-white px-8 py-4 rounded-xl font-bold hover:bg-teal-800 transition-all shadow-lg shadow-teal-700/20 hover:-translate-y-0.5 transform"
                        >
                            {t('features.hero_cta')}
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        </Link>
                        <Link
                            href="/guia"
                            className="inline-flex items-center gap-2 px-6 py-4 rounded-xl font-semibold text-stone-500 bg-stone-100 hover:bg-stone-200 transition-all"
                        >
                            {t('features.final_question')}
                        </Link>
                    </div>
                </div>
            </section>

            <div className="text-center pb-10">
                <Link href="/" className="text-stone-400 hover:text-stone-500 text-sm transition-colors">
                    ← {t('common.back')}
                </Link>
            </div>
        </main>
    );
}
