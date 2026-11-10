'use client';

/**
 * «Para hacer ahora»: an animal's due follow-ups, each with its contact button
 * (WhatsApp / Telegram, message already written) and «Registrar». One block,
 * shown in two places so it reads and works the same (Nielsen #4): under the
 * animal page's header, and in the panel the homepage's Mis animales card
 * opens over the home (Jon 2026-11-09, option C).
 *
 * `useDueSlotCopy` is the wording the animal's timeline also uses for the same
 * slots (label, «te quedan N días», contact button).
 */

import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { interpolate } from '@/lib/interpolate';
import { dueWhenText } from '@/lib/dueWhenText';
import type { ProjectedSlot } from '@/app/actions/animalTimeline';

export function useDueSlotCopy() {
    const { t } = useLanguage();
    const toast = useShowToast();

    /** Days still available to log a due slot (0 = last day). The window is the
     *  answer to "how long do I have", so show it as a countdown, not a date. */
    const daysLeft = (s: ProjectedSlot) => Math.max(0, Math.ceil((s.windowEndsAt - Date.now()) / 86400000));
    const windowCopy = (s: ProjectedSlot) => {
        const n = daysLeft(s);
        return n === 0
            ? (t('followups.last_day') || 'último día para registrarlo')
            : interpolate(t('followups.days_left') || 'te quedan {days} días para registrarlo', { days: n });
    };

    const slotLabel = (s: ProjectedSlot) =>
        (s.copyKey === 'checkin_custom' || s.copyKey === 'foster_checkin')
            ? interpolate(t(`followups.${s.copyKey}`) || '{days}', { days: s.offsetDays ?? '' })
            : (t(`followups.${s.copyKey}`) || s.key);

    /** Telegram can't prefill text — copy the message alongside opening the chat. */
    const onContactClick = (s: ProjectedSlot) => {
        if (s.contact?.channel === 'telegram') {
            navigator.clipboard?.writeText(s.contact.message).catch(() => { /* clipboard blocked: the chat still opens */ });
            toast.success(t('followups.tg_copied_title') || 'Mensaje copiado', t('followups.tg_copied') || 'Pegalo en el chat de Telegram.');
        }
    };

    const contactButton = (s: ProjectedSlot) => s.contact ? (
        <a
            href={s.contact.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onContactClick(s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors whitespace-nowrap"
            data-testid={`contact-${s.key}`}
        >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" /></svg>
            {s.contact.channel === 'telegram' ? 'Telegram' : 'WhatsApp'}
        </a>
    ) : null;

    return { slotLabel, windowCopy, contactButton };
}

export default function DueNowBlock({ slots, placementId, onRegister, anchorId, className = '' }: {
    /** The `due` slots of the animal's active placement. */
    slots: ProjectedSlot[];
    placementId: string | undefined;
    onRegister: (s: ProjectedSlot) => void;
    /** `next-action` on the animal page: notifications and emails link to it. */
    anchorId?: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const { slotLabel, windowCopy, contactButton } = useDueSlotCopy();
    if (slots.length === 0) return null;
    return (
        <div className={`bg-white rounded-2xl border border-stone-200 border-l-[3px] border-l-amber-500 shadow-sm p-4 ${className}`} id={anchorId} data-testid="due-banner">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2">{t('followups.para_hacer') || 'Para hacer ahora'}</p>
            <div className="space-y-3">
                {slots.map(s => (
                    <div key={s.key} id={`followup-${placementId}-${s.key}`} className="flex flex-wrap items-center gap-2" data-testid={`due-slot-${s.key}`}>
                        <div className="flex-1 min-w-[180px]">
                            <p className="text-sm font-semibold text-stone-800">{slotLabel(s)}</p>
                            <p className="text-xs text-stone-500">
                                {dueWhenText(t, s.dueDate, Date.now(), formatShortDate)} · {windowCopy(s)}
                            </p>
                        </div>
                        {contactButton(s)}
                        <button
                            type="button"
                            onClick={() => onRegister(s)}
                            className="inline-flex px-3 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                            data-testid={`register-${s.key}`}
                        >
                            {t('followups.register') || 'Registrar'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
