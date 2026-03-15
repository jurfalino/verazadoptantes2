'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { ShieldPawIcon } from '@/components/Logo';

/* ── Feature data (no emojis — icons are SVG inline) ────────────── */

const FEATURES = [
    { key: 'search', img: '/images/features/search.png', color: 'teal' },
    { key: 'import', img: '/images/features/mobile-share.png', color: 'amber' },
    { key: 'dashboard', img: '/images/features/dashboard.png', color: 'violet' },
    { key: 'orgs', img: '/images/features/team.png', color: 'indigo' },
    { key: 'safety', img: '/images/features/safety.png', color: 'rose' },
    { key: 'forms', img: '/images/features/search.png', color: 'sky' },
] as const;

const COLOR_MAP: Record<string, { card: string; ring: string; badge: string }> = {
    teal:   { card: 'from-teal-50 to-teal-100/40',   ring: 'ring-teal-200',   badge: 'bg-teal-100 text-teal-800' },
    amber:  { card: 'from-amber-50 to-amber-100/40',  ring: 'ring-amber-200',  badge: 'bg-amber-100 text-amber-800' },
    violet: { card: 'from-violet-50 to-violet-100/40', ring: 'ring-violet-200', badge: 'bg-violet-100 text-violet-800' },
    indigo: { card: 'from-indigo-50 to-indigo-100/40', ring: 'ring-indigo-200', badge: 'bg-indigo-100 text-indigo-800' },
    rose:   { card: 'from-rose-50 to-rose-100/40',    ring: 'ring-rose-200',   badge: 'bg-rose-100 text-rose-800' },
    sky:    { card: 'from-sky-50 to-sky-100/40',      ring: 'ring-sky-200',    badge: 'bg-sky-100 text-sky-800' },
};

/* ── Intersection Observer for fade-in animations ────────────── */

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
            { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
        );
        el.querySelectorAll('.reveal').forEach((child) => observer.observe(child));
        return () => observer.disconnect();
    }, []);
    return ref;
}

/* ── Page ────────────────────────────────────────────────────── */

export default function FuncionalidadesPage() {
    const { t } = useLanguage();
    const containerRef = useScrollReveal();

    return (
        <main ref={containerRef} className="min-h-screen bg-stone-50">
            {/* ── Inline styles for reveal animation ── */}
            <style>{`
                .reveal {
                    opacity: 0;
                    transform: translateY(32px);
                    transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .reveal.animate-in {
                    opacity: 1;
                    transform: translateY(0);
                }
            `}</style>

            {/* ═══════════════════════════════════════════════════════
                HERO
            ═══════════════════════════════════════════════════════ */}
            <header className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-teal-900 text-white">
                {/* Decorative pattern */}
                <div className="absolute inset-0 opacity-[0.07]" style={{
                    backgroundImage: 'radial-gradient(circle at 20% 30%, white 1.5px, transparent 1.5px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)',
                    backgroundSize: '48px 48px',
                }} />

                {/* Gradient overlay for depth */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />

                <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-28 lg:py-32">
                    <div className="grid lg:grid-cols-2 gap-10 items-center">
                        {/* Left: Copy */}
                        <div className="space-y-6">
                            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/10">
                                <ShieldPawIcon className="w-5 h-5" />
                                <span className="text-sm font-semibold tracking-wide">BuenAdoptante</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight leading-[1.1]">
                                {t('features.hero_title')}
                            </h1>
                            <p className="text-teal-100 text-lg md:text-xl max-w-lg font-medium leading-relaxed">
                                {t('features.hero_subtitle')}
                            </p>
                            <div className="flex flex-wrap gap-3 pt-2">
                                <Link
                                    href="/"
                                    className="inline-flex items-center gap-2 bg-white text-teal-800 px-7 py-3.5 rounded-xl font-bold hover:bg-teal-50 transition-all shadow-lg shadow-black/10 hover:-translate-y-0.5 transform text-sm"
                                >
                                    {t('features.hero_cta')}
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                                </Link>
                                <Link
                                    href="/guia"
                                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-white/90 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 transition-all text-sm"
                                >
                                    {t('features.hero_cta_guide')}
                                </Link>
                            </div>
                        </div>

                        {/* Right: Hero image */}
                        <div className="hidden lg:block relative">
                            <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-black/30 ring-1 ring-white/10">
                                <Image
                                    src="/images/features/hero.png"
                                    alt="BuenAdoptante platform"
                                    width={640}
                                    height={400}
                                    className="w-full h-auto"
                                    priority
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-teal-900/30 to-transparent" />
                            </div>
                            {/* Floating accent */}
                            <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-amber-400/20 rounded-full blur-2xl" />
                            <div className="absolute -top-6 -right-6 w-32 h-32 bg-teal-400/15 rounded-full blur-3xl" />
                        </div>
                    </div>
                </div>
            </header>

            {/* ═══════════════════════════════════════════════════════
                PAIN → SOLUTION
            ═══════════════════════════════════════════════════════ */}
            <section className="relative -mt-8 z-10 max-w-5xl mx-auto px-4">
                <div className="reveal grid md:grid-cols-3 gap-5">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="bg-white rounded-2xl border border-stone-200 shadow-lg shadow-stone-200/50 overflow-hidden group hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                            {/* Before */}
                            <div className="px-5 py-4 bg-stone-50 border-b border-stone-100">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{t('features.before_label')}</span>
                                <p className="text-stone-500 text-sm mt-1.5 leading-relaxed">{t(`features.pain${n}_before`)}</p>
                            </div>
                            {/* After */}
                            <div className="px-5 py-4">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-teal-600">{t('features.after_label')}</span>
                                <p className="text-stone-800 text-sm mt-1.5 leading-relaxed font-medium">{t(`features.pain${n}_after`)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════
                FEATURE SHOWCASE
            ═══════════════════════════════════════════════════════ */}
            <section className="max-w-6xl mx-auto px-4 py-20 md:py-28 space-y-20 md:space-y-28">
                <div className="text-center reveal">
                    <h2 className="text-3xl md:text-4xl font-extrabold text-stone-900 tracking-tight">{t('features.pain_title')}</h2>
                    <div className="w-16 h-1 bg-teal-500 mx-auto mt-4 rounded-full" />
                </div>

                {FEATURES.map((feat, i) => {
                    const colors = COLOR_MAP[feat.color];
                    const isReversed = i % 2 === 1;

                    return (
                        <div
                            key={feat.key}
                            className={`reveal grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${isReversed ? 'lg:direction-rtl' : ''}`}
                        >
                            {/* Image */}
                            <div className={`${isReversed ? 'lg:order-2' : ''}`}>
                                <div className={`relative rounded-3xl overflow-hidden bg-gradient-to-br ${colors.card} p-3 ring-1 ${colors.ring} shadow-md`}>
                                    <Image
                                        src={feat.img}
                                        alt={t(`features.feat_${feat.key}_title`)}
                                        width={560}
                                        height={560}
                                        className="w-full h-auto rounded-2xl"
                                    />
                                </div>
                            </div>

                            {/* Text */}
                            <div className={`space-y-4 ${isReversed ? 'lg:order-1' : ''}`}>
                                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${colors.badge}`}>
                                    {String(i + 1).padStart(2, '0')}
                                </span>
                                <h3 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">
                                    {t(`features.feat_${feat.key}_title`)}
                                </h3>
                                <p className="text-stone-600 text-base md:text-lg leading-relaxed max-w-md">
                                    {t(`features.feat_${feat.key}_desc`)}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </section>

            {/* ═══════════════════════════════════════════════════════
                TRUST SIGNALS
            ═══════════════════════════════════════════════════════ */}
            <section className="bg-white border-y border-stone-200">
                <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
                    <div className="reveal grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
                        {(['free', 'privacy', 'mobile', 'bilingual'] as const).map((key) => (
                            <div key={key} className="text-center group">
                                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center group-hover:bg-teal-50 group-hover:border-teal-100 transition-colors">
                                    {key === 'free' && (
                                        <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                                    )}
                                    {key === 'privacy' && (
                                        <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                    )}
                                    {key === 'mobile' && (
                                        <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                    )}
                                    {key === 'bilingual' && (
                                        <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                                    )}
                                </div>
                                <p className="text-sm font-semibold text-stone-800">{t(`features.trust_${key}`)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════
                FINAL CTA
            ═══════════════════════════════════════════════════════ */}
            <section className="max-w-3xl mx-auto px-4 py-20 md:py-28 text-center">
                <div className="reveal space-y-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-50 border border-teal-100">
                        <ShieldPawIcon className="w-9 h-9" />
                    </div>
                    <h2 className="text-3xl md:text-4xl font-extrabold text-stone-900 tracking-tight">
                        {t('features.final_cta')}
                    </h2>
                    <p className="text-stone-500 text-lg">{t('features.hero_subtitle')}</p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 bg-teal-600 text-white px-8 py-4 rounded-xl font-bold hover:bg-teal-700 transition-all shadow-lg shadow-teal-600/20 hover:-translate-y-0.5 transform"
                        >
                            {t('features.hero_cta')}
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        </Link>
                        <Link
                            href="/guia"
                            className="inline-flex items-center gap-2 px-6 py-4 rounded-xl font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-all"
                        >
                            {t('features.final_question')}
                        </Link>
                    </div>
                </div>
            </section>

            {/* Back link */}
            <div className="text-center pb-10">
                <Link
                    href="/"
                    className="text-stone-400 hover:text-stone-600 text-sm font-medium transition-colors"
                >
                    ← {t('common.back')}
                </Link>
            </div>
        </main>
    );
}
