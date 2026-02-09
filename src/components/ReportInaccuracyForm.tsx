'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface ReportFormProps {
    adopterId: string;
    adopterName: string;
}

export default function ReportInaccuracyForm({ adopterId, adopterName }: ReportFormProps) {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim() || !details.trim()) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/data-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adopterId,
                    requesterName: name.trim(),
                    requesterEmail: email.trim() || null,
                    requestType: 'inaccuracy',
                    details: details.trim(),
                }),
            });
            if (res.ok) {
                setSubmitted(true);
            }
        } catch {
            // silently fail
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-center">
                <p className="text-teal-800 text-sm">
                    ✅ {t('legal.report_submitted') || 'Report submitted. We will review it within 10 business days.'}
                </p>
            </div>
        );
    }

    return (
        <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5">
            <div className="flex items-center justify-between">
                <p className="text-stone-500 text-xs">
                    ℹ️ {t('legal.disclaimer')}
                </p>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="text-teal-600 hover:text-teal-800 text-xs underline underline-offset-2 whitespace-nowrap ml-3"
                >
                    {isOpen ? (t('common.close') || 'Close') : (t('legal.report_error') || 'Report an error')}
                </button>
            </div>

            {isOpen && (
                <div className="mt-3 pt-3 border-t border-stone-200 space-y-3">
                    <p className="text-xs text-stone-500">
                        {t('legal.report_desc') || 'If this profile contains incorrect information about you, let us know:'}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <input
                            type="text"
                            placeholder={t('legal.your_name') || 'Your name *'}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-teal-500 focus:border-teal-500"
                        />
                        <input
                            type="email"
                            placeholder={t('legal.your_email') || 'Your email (optional)'}
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-teal-500 focus:border-teal-500"
                        />
                    </div>
                    <textarea
                        placeholder={t('legal.report_details') || 'What information is incorrect? *'}
                        value={details}
                        onChange={e => setDetails(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-teal-500 focus:border-teal-500 resize-none"
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !name.trim() || !details.trim()}
                            className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? (t('common.processing') || 'Sending...') : (t('legal.send_report') || 'Send Report')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
