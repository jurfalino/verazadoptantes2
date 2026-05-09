'use client';
export const runtime = 'edge';

import { useState, useEffect } from 'react';
import { useShowToast } from '@/components/ui/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { formatShortDate } from '@/lib/dates';
import { extractErrorId } from '@/lib/errorUtils';

async function readErrorBody(res: Response): Promise<{ error?: string; errorId?: string }> {
    try {
        return await res.json() as { error?: string; errorId?: string };
    } catch {
        return {};
    }
}

interface SocialProofMessage {
    city: string;
    count: number;
    period: string;
}

interface ConfigData {
    config?: {
        too_many_adoptions_threshold?: string;
        too_many_adoptions_period_days?: string;
        too_many_requests_threshold?: string;
        too_many_requests_period_days?: string;
        ENABLE_CONTENT_IMPORT?: string;
        ENABLE_ANIMALS_FOR_ADOPTION?: string;
        ENABLE_SEARCH_CARD_METADATA?: string;
        ENABLE_CHAT_WIDGET?: string;
        TELEGRAM_ADMIN_CHAT_ID?: string;
        TELEGRAM_BOT_TOKEN_SET?: string;
        TELEGRAM_WEBHOOK_SECRET_SET?: string;
        SOCIAL_PROOF_ENABLED?: string;
        SOCIAL_PROOF_MESSAGES?: string;
    };
    statsCount?: number;
    oldestStat?: string | null;
}

interface PurgeData {
    deleted: number;
    remaining: number;
}

// Feature flags definition — labels & descriptions live in i18n (admin.flag_label_*/flag_desc_*)
const FEATURE_FLAGS = [
    { key: 'ENABLE_CONTENT_IMPORT', labelKey: 'flag_label_content_import', descKey: 'flag_desc_content_import' },
    { key: 'ENABLE_ANIMALS_FOR_ADOPTION', labelKey: 'flag_label_animals_for_adoption', descKey: 'flag_desc_animals_for_adoption' },
    { key: 'ENABLE_SEARCH_CARD_METADATA', labelKey: 'flag_label_search_card_metadata', descKey: 'flag_desc_search_card_metadata' },
    { key: 'ENABLE_CHAT_WIDGET', labelKey: 'flag_label_chat_widget', descKey: 'flag_desc_chat_widget' },
];

export default function AdminConfigPage() {
    const toast = useShowToast();
    const { t } = useLanguage();
    const [config, setConfig] = useState({
        too_many_adoptions_threshold: '5',
        too_many_adoptions_period_days: '90',
        too_many_requests_threshold: '3',
        too_many_requests_period_days: '30'
    });
    const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({
        ENABLE_CONTENT_IMPORT: false,
        ENABLE_ANIMALS_FOR_ADOPTION: false,
        ENABLE_SEARCH_CARD_METADATA: true,
        ENABLE_CHAT_WIDGET: false,
    });
    const [telegramAdminChatId, setTelegramAdminChatId] = useState('');
    const [telegramBotToken, setTelegramBotToken] = useState('');
    const [telegramWebhookSecret, setTelegramWebhookSecret] = useState('');
    const [telegramBotTokenSet, setTelegramBotTokenSet] = useState(false);
    const [telegramWebhookSecretSet, setTelegramWebhookSecretSet] = useState(false);
    const [savingTelegram, setSavingTelegram] = useState(false);
    const [telegramSetupResult, setTelegramSetupResult] = useState<string | null>(null);
    const [socialProofEnabled, setSocialProofEnabled] = useState(false);
    const [socialProofMessages, setSocialProofMessages] = useState<SocialProofMessage[]>([]);
    const [savingSocialProof, setSavingSocialProof] = useState(false);
    const [statsCount, setStatsCount] = useState<number | null>(null);
    const [oldestStat, setOldestStat] = useState<string | null>(null);
    const [purgeDays, setPurgeDays] = useState('365');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingFlags, setSavingFlags] = useState(false);
    const [purging, setPurging] = useState(false);

    // Fetch current config and stats info
    useEffect(() => {
        async function fetchData() {
            try {
                const res = await fetch('/api/admin/config');
                if (res.ok) {
                    const data: ConfigData = await res.json();
                    setConfig({
                        too_many_adoptions_threshold: data.config?.too_many_adoptions_threshold || '5',
                        too_many_adoptions_period_days: data.config?.too_many_adoptions_period_days || '90',
                        too_many_requests_threshold: data.config?.too_many_requests_threshold || '3',
                        too_many_requests_period_days: data.config?.too_many_requests_period_days || '30'
                    });
                    // Set feature flags from config
                    setFeatureFlags({
                        ENABLE_CONTENT_IMPORT: data.config?.ENABLE_CONTENT_IMPORT === 'true',
                        ENABLE_ANIMALS_FOR_ADOPTION: data.config?.ENABLE_ANIMALS_FOR_ADOPTION === 'true',
                        ENABLE_SEARCH_CARD_METADATA: data.config?.ENABLE_SEARCH_CARD_METADATA !== 'false',
                        ENABLE_CHAT_WIDGET: data.config?.ENABLE_CHAT_WIDGET === 'true',
                    });
                    setTelegramAdminChatId(data.config?.TELEGRAM_ADMIN_CHAT_ID || '');
                    setTelegramBotTokenSet(data.config?.TELEGRAM_BOT_TOKEN_SET === 'true');
                    setTelegramWebhookSecretSet(data.config?.TELEGRAM_WEBHOOK_SECRET_SET === 'true');
                    // Social proof config
                    setSocialProofEnabled(data.config?.SOCIAL_PROOF_ENABLED === 'true');
                    try {
                        const msgs = data.config?.SOCIAL_PROOF_MESSAGES ? JSON.parse(data.config.SOCIAL_PROOF_MESSAGES) : [];
                        setSocialProofMessages(msgs);
                    } catch { setSocialProofMessages([]); }
                    setStatsCount(data.statsCount ?? null);
                    setOldestStat(data.oldestStat ?? null);
                }
            } catch (e) {
                console.error('Failed to fetch config:', e);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    const handleSaveConfig = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            if (res.ok) {
                toast.success(t('toast.saved_title'), t('toast.saved_message'));
            } else {
                const body = await readErrorBody(res);
                toast.error(t('errors.generic'), body.error || t('errors.save_config_failed'), body.errorId);
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.config_error'), extractErrorId(e));
        } finally {
            setSaving(false);
        }
    };

    const handleToggleFlag = async (flagKey: string, newValue: boolean) => {
        setSavingFlags(true);
        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [flagKey]: newValue ? 'true' : 'false' })
            });
            if (res.ok) {
                setFeatureFlags(prev => ({ ...prev, [flagKey]: newValue }));
            } else {
                const body = await readErrorBody(res);
                toast.error(t('errors.generic'), body.error || t('errors.save_flag_failed'), body.errorId);
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.flag_error'), extractErrorId(e));
        } finally {
            setSavingFlags(false);
        }
    };

    const handleSaveSocialProof = async () => {
        setSavingSocialProof(true);
        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    SOCIAL_PROOF_ENABLED: socialProofEnabled ? 'true' : 'false',
                    SOCIAL_PROOF_MESSAGES: JSON.stringify(socialProofMessages.filter(m => m.city.trim())),
                })
            });
            if (res.ok) {
                toast.success(t('toast.saved_title'), t('toast.social_proof_saved'));
            } else {
                const body = await readErrorBody(res);
                toast.error(t('errors.generic'), body.error || t('errors.save_social_proof_failed'), body.errorId);
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.social_proof_error'), extractErrorId(e));
        } finally {
            setSavingSocialProof(false);
        }
    };

    const addSocialProofMessage = () => {
        setSocialProofMessages(prev => [...prev, { city: '', count: 1, period: 'esta semana' }]);
    };

    const updateSocialProofMessage = (idx: number, field: keyof SocialProofMessage, value: string | number) => {
        setSocialProofMessages(prev => prev.map((m, i) =>
            i === idx ? { ...m, [field]: value } : m
        ));
    };

    const removeSocialProofMessage = (idx: number) => {
        setSocialProofMessages(prev => prev.filter((_, i) => i !== idx));
    };

    const handlePurgeStats = async () => {
        if (!confirm(t('dialogs.confirm_purge_stats').replace('{days}', String(purgeDays)))) {
            return;
        }
        setPurging(true);
        try {
            const res = await fetch('/api/admin/stats/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: parseInt(purgeDays) })
            });
            if (res.ok) {
                const data: PurgeData = await res.json();
                toast.success(t('toast.stats_purged_title'), t('toast.stats_purged_message').replace('{count}', String(data.deleted)));
                setStatsCount(data.remaining);
                // Refresh oldest stat
                const configRes = await fetch('/api/admin/config');
                if (configRes.ok) {
                    const configData: ConfigData = await configRes.json();
                    setOldestStat(configData.oldestStat ?? null);
                }
            } else {
                const body = await readErrorBody(res);
                toast.error(t('errors.generic'), body.error || t('errors.purge_stats_failed'), body.errorId);
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.purge_stats_error'), extractErrorId(e));
        } finally {
            setPurging(false);
        }
    };

    if (loading) {
        return <div className="text-stone-500">{t('admin.loading_config')}</div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <header>
                <h2 className="text-3xl font-semibold text-stone-900">{t('admin.system_config')}</h2>
                <p className="text-stone-500 mt-2">{t('admin.system_config_desc')}</p>
            </header>

            {/* Feature Flags */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">🚩</span>
                    {t('admin.feature_flags_title')}
                </h3>
                <p className="text-sm text-stone-500 mb-4">
                    {t('admin.feature_flags_desc')}
                </p>
                <div className="space-y-4">
                    {FEATURE_FLAGS.map(flag => (
                        <div key={flag.key} className="flex items-center justify-between p-4 bg-stone-50 rounded-xl">
                            <div>
                                <p className="font-semibold text-stone-800">{t(`admin.${flag.labelKey}`)}</p>
                                <p className="text-sm text-stone-500">{t(`admin.${flag.descKey}`)}</p>
                            </div>
                            <button
                                onClick={() => handleToggleFlag(flag.key, !featureFlags[flag.key])}
                                disabled={savingFlags}
                                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${featureFlags[flag.key] ? 'bg-blue-600' : 'bg-stone-300'
                                    }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${featureFlags[flag.key] ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Telegram support chat */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">💬</span>
                    Telegram Support Chat
                </h3>
                <p className="text-sm text-stone-500 mb-4">
                    Routes the floating chat widget to your personal Telegram. After filling in the bot token, webhook
                    secret, and chat_id, click <strong>Save &amp; register webhook</strong> — the server stores the values and
                    immediately calls Telegram&apos;s <code className="px-1 bg-stone-100 rounded text-xs">setWebhook</code> for you.
                    Walk-through (BotFather, capturing chat_id):{' '}
                    <code className="px-1 bg-stone-100 rounded text-xs">docs/CHAT_SETUP.md</code>.
                </p>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4">
                    <strong>Security note.</strong> Saved values are stored in the app database. They&apos;re visible to
                    anyone with admin DB access. For higher isolation, set them as Cloudflare secrets
                    (<code className="px-1 bg-white border border-amber-200 rounded">wrangler pages secret put TELEGRAM_BOT_TOKEN</code>)
                    and leave the fields blank — the app reads DB first, then the Cloudflare secret as a fallback.
                </p>
                <div className="p-4 bg-stone-50 rounded-xl space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                            Bot token
                            {telegramBotTokenSet && <span className="ml-2 text-emerald-600 normal-case font-normal">(currently set)</span>}
                        </label>
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={telegramBotToken}
                            onChange={(e) => setTelegramBotToken(e.target.value)}
                            placeholder={telegramBotTokenSet ? '•••••••• (leave blank to keep current value)' : 'e.g. 1234567890:AAH...XYZ'}
                            className="w-full h-10 px-4 rounded-lg border border-stone-200 bg-white text-stone-950 font-mono text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                            Webhook secret
                            {telegramWebhookSecretSet && <span className="ml-2 text-emerald-600 normal-case font-normal">(currently set)</span>}
                        </label>
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={telegramWebhookSecret}
                            onChange={(e) => setTelegramWebhookSecret(e.target.value)}
                            placeholder={telegramWebhookSecretSet ? '•••••••• (leave blank to keep current value)' : 'e.g. 32+ random hex chars'}
                            className="w-full h-10 px-4 rounded-lg border border-stone-200 bg-white text-stone-950 font-mono text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                        />
                        <p className="text-xs text-stone-500 mt-1.5">
                            Random string the server uses to authenticate inbound webhook calls. Generate with
                            {' '}<code className="px-1 bg-white border border-stone-200 rounded">openssl rand -hex 32</code>.
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">Admin chat_id</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="-?\d+"
                            value={telegramAdminChatId}
                            onChange={(e) => setTelegramAdminChatId(e.target.value)}
                            placeholder="e.g. 123456789"
                            className="w-full h-10 px-4 rounded-lg border border-stone-200 bg-white text-stone-950 font-mono text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                        />
                        <p className="text-xs text-stone-500 mt-1.5">
                            Send <code className="px-1 bg-white border border-stone-200 rounded">/start</code> to your bot, then
                            open <code className="px-1 bg-white border border-stone-200 rounded">/getUpdates</code> in a browser to capture this number.
                            Do this <em>before</em> registering the webhook.
                        </p>
                    </div>
                    {telegramSetupResult && (
                        <p className={`text-sm rounded-lg p-2.5 border ${telegramSetupResult.startsWith('✓')
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                            {telegramSetupResult}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                setSavingTelegram(true);
                                setTelegramSetupResult(null);
                                try {
                                    // Only send fields the user actually edited — empty bot/secret means "keep current".
                                    const payload: Record<string, unknown> = {
                                        TELEGRAM_ADMIN_CHAT_ID: telegramAdminChatId.trim(),
                                        registerWebhook: true,
                                    };
                                    if (telegramBotToken) payload.TELEGRAM_BOT_TOKEN = telegramBotToken;
                                    if (telegramWebhookSecret) payload.TELEGRAM_WEBHOOK_SECRET = telegramWebhookSecret;

                                    const res = await fetch('/api/admin/telegram/setup', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(payload),
                                    });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) {
                                        const errMsg = (data as { error?: string }).error || 'Setup failed';
                                        setTelegramSetupResult(`✗ ${errMsg}`);
                                        toast.error(t('errors.generic'), errMsg, (data as { errorId?: string }).errorId);
                                        return;
                                    }
                                    // Clear sensitive inputs after a successful save
                                    setTelegramBotToken('');
                                    setTelegramWebhookSecret('');
                                    const result = data as { status?: { botTokenSet?: boolean; webhookSecretSet?: boolean; adminChatIdSet?: boolean }; webhook?: { ok?: boolean; error?: string; description?: string; url?: string } | null };
                                    setTelegramBotTokenSet(!!result.status?.botTokenSet);
                                    setTelegramWebhookSecretSet(!!result.status?.webhookSecretSet);
                                    if (result.webhook == null) {
                                        setTelegramSetupResult('✓ Saved.');
                                    } else if (result.webhook.ok) {
                                        setTelegramSetupResult(`✓ Saved + webhook registered at ${result.webhook.url}.`);
                                    } else {
                                        setTelegramSetupResult(`Saved, but webhook registration failed: ${result.webhook.error || 'unknown error'}.`);
                                    }
                                    toast.success(t('toast.saved_title'), t('admin.telegram_saved') || 'Telegram configuration updated.');
                                } catch (e) {
                                    setTelegramSetupResult(`✗ ${e instanceof Error ? e.message : 'Network error'}`);
                                } finally {
                                    setSavingTelegram(false);
                                }
                            }}
                            disabled={savingTelegram}
                            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {savingTelegram ? 'Saving…' : 'Save & register webhook'}
                        </button>
                        <button
                            onClick={async () => {
                                setSavingTelegram(true);
                                setTelegramSetupResult(null);
                                try {
                                    const res = await fetch('/api/admin/telegram/setup', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ registerWebhook: true }),
                                    });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) {
                                        const errMsg = (data as { error?: string }).error || 'Failed to register webhook';
                                        setTelegramSetupResult(`✗ ${errMsg}`);
                                        return;
                                    }
                                    const result = data as { webhook?: { ok?: boolean; error?: string; url?: string } | null };
                                    if (result.webhook?.ok) {
                                        setTelegramSetupResult(`✓ Webhook registered at ${result.webhook.url}.`);
                                    } else {
                                        setTelegramSetupResult(`✗ ${result.webhook?.error || 'unknown error'}`);
                                    }
                                } catch (e) {
                                    setTelegramSetupResult(`✗ ${e instanceof Error ? e.message : 'Network error'}`);
                                } finally {
                                    setSavingTelegram(false);
                                }
                            }}
                            disabled={savingTelegram}
                            className="px-5 py-2 bg-stone-100 text-stone-700 text-sm font-semibold rounded-lg hover:bg-stone-200 transition-colors disabled:opacity-50 border border-stone-200"
                        >
                            Re-register webhook
                        </button>
                    </div>
                </div>
            </div>

            {/* Social Proof Banner */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    Social Proof Banner
                </h3>
                <p className="text-sm text-stone-500 mb-4">
                    Show a rotating banner on the homepage with adoption activity stats. Messages rotate every 8 seconds.
                </p>

                {/* Enable toggle */}
                <div className="flex items-center justify-between p-4 bg-stone-50 rounded-xl mb-4">
                    <div>
                        <p className="font-semibold text-stone-800">Enable Banner</p>
                        <p className="text-sm text-stone-500">Show social proof messages on the homepage</p>
                    </div>
                    <button
                        onClick={() => setSocialProofEnabled(!socialProofEnabled)}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                            socialProofEnabled ? 'bg-blue-600' : 'bg-stone-300'
                        }`}
                    >
                        <span
                            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                socialProofEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>

                {/* Messages list */}
                <div className="space-y-3 mb-4">
                    {socialProofMessages.map((msg, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-3 bg-stone-50 rounded-lg">
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs font-medium text-stone-600 mb-1">City / Org</label>
                                    <input
                                        type="text"
                                        value={msg.city}
                                        onChange={(e) => updateSocialProofMessage(idx, 'city', e.target.value)}
                                        placeholder="Buenos Aires"
                                        className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-400"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-stone-600 mb-1">Count</label>
                                    <input
                                        type="number"
                                        value={msg.count}
                                        onChange={(e) => updateSocialProofMessage(idx, 'count', parseInt(e.target.value) || 0)}
                                        min="1"
                                        className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-400"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-stone-600 mb-1">Period</label>
                                    <input
                                        type="text"
                                        value={msg.period}
                                        onChange={(e) => updateSocialProofMessage(idx, 'period', e.target.value)}
                                        placeholder="esta semana"
                                        className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-400"
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => removeSocialProofMessage(idx)}
                                className="mt-5 text-stone-400 hover:text-rose-500 transition-colors text-sm"
                                aria-label={t('admin.remove_message_aria')}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={addSocialProofMessage}
                        className="px-4 py-1.5 text-sm font-medium text-stone-600 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
                    >
                        + Add Message
                    </button>
                    <button
                        onClick={handleSaveSocialProof}
                        disabled={savingSocialProof}
                        className="px-6 py-1.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-600 disabled:opacity-50 transition-colors"
                    >
                        {savingSocialProof ? 'Saving...' : 'Save Social Proof'}
                    </button>
                </div>
            </div>

            {/* Threshold Configuration */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">⚙️</span>
                    Adoption Threshold Settings
                </h3>
                <p className="text-sm text-stone-500 mb-4">
                    Configure the threshold for flagging adopters with "too many adoptions".
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-stone-700 mb-1">Max Adoptions</label>
                        <input
                            type="number"
                            value={config.too_many_adoptions_threshold}
                            onChange={(e) => setConfig({ ...config, too_many_adoptions_threshold: e.target.value })}
                            className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                            min="1"
                        />
                        <span className="text-xs text-stone-500">adoptions</span>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-stone-700 mb-1">Time Period</label>
                        <input
                            type="number"
                            value={config.too_many_adoptions_period_days}
                            onChange={(e) => setConfig({ ...config, too_many_adoptions_period_days: e.target.value })}
                            className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                            min="1"
                        />
                        <span className="text-xs text-stone-500">days</span>
                    </div>
                </div>

                {/* Adoption Requests Threshold */}
                <div className="mt-6 pt-6 border-t border-stone-200">
                    <h4 className="text-md font-semibold text-stone-800 mb-2 flex items-center gap-2">
                        <span>📋</span>
                        Adoption Requests Threshold
                    </h4>
                    <p className="text-sm text-stone-500 mb-4">
                        Configure the threshold for flagging adopters with too many adoption requests.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-1">Max Requests</label>
                            <input
                                type="number"
                                value={config.too_many_requests_threshold}
                                onChange={(e) => setConfig({ ...config, too_many_requests_threshold: e.target.value })}
                                className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                                min="1"
                            />
                            <span className="text-xs text-stone-500">requests</span>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-1">Time Period</label>
                            <input
                                type="number"
                                value={config.too_many_requests_period_days}
                                onChange={(e) => setConfig({ ...config, too_many_requests_period_days: e.target.value })}
                                className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                                min="1"
                            />
                            <span className="text-xs text-stone-500">days</span>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="mt-6 px-6 py-2 bg-teal-700 text-white font-semibold rounded-lg hover:bg-teal-600 disabled:opacity-50 transition-colors"
                >
                    {saving ? 'Saving...' : 'Save All Settings'}
                </button>
            </div>

            {/* Stats Cleanup */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    Stats Cleanup
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 p-4 bg-stone-50 rounded-lg">
                    <div>
                        <span className="text-sm text-stone-500">Total Events</span>
                        <p className="text-2xl font-semibold text-stone-900">{statsCount?.toLocaleString() ?? '—'}</p>
                    </div>
                    <div>
                        <span className="text-sm text-stone-500">Oldest Event</span>
                        <p className="text-lg font-semibold text-stone-700">
                            {oldestStat ? formatShortDate(new Date(oldestStat)) : '—'}
                        </p>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-semibold text-stone-700 mb-1">Purge events older than</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={purgeDays}
                                onChange={(e) => setPurgeDays(e.target.value)}
                                className="w-24 px-4 py-2 border border-stone-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
                                min="30"
                            />
                            <span className="text-sm text-stone-500">days</span>
                        </div>
                    </div>
                    <button
                        onClick={handlePurgeStats}
                        disabled={purging}
                        className="px-6 py-2 bg-rose-500 text-white font-semibold rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                        {purging ? 'Purging...' : '🗑 Purge Old Stats'}
                    </button>
                </div>
                <p className="text-xs text-stone-500 mt-2">
                    ⚠️ This action is irreversible. Purged stats cannot be recovered.
                </p>
            </div>
        </div>
    );
}

