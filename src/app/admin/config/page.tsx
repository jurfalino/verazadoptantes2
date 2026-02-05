'use client';

import { useState, useEffect } from 'react';

interface ConfigData {
    config?: {
        too_many_adoptions_threshold?: string;
        too_many_adoptions_period_days?: string;
        too_many_requests_threshold?: string;
        too_many_requests_period_days?: string;
    };
    statsCount?: number;
    oldestStat?: string | null;
}

interface PurgeData {
    deleted: number;
    remaining: number;
}
export default function AdminConfigPage() {
    const [config, setConfig] = useState({
        too_many_adoptions_threshold: '5',
        too_many_adoptions_period_days: '90',
        too_many_requests_threshold: '3',
        too_many_requests_period_days: '30'
    });
    const [statsCount, setStatsCount] = useState<number | null>(null);
    const [oldestStat, setOldestStat] = useState<string | null>(null);
    const [purgeDays, setPurgeDays] = useState('365');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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
                alert('Configuration saved!');
            } else {
                alert('Failed to save configuration');
            }
        } catch (e) {
            console.error(e);
            alert('Error saving configuration');
        } finally {
            setSaving(false);
        }
    };

    const handlePurgeStats = async () => {
        if (!confirm(`Are you sure you want to delete stats older than ${purgeDays} days? This cannot be undone.`)) {
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
                alert(`Purged ${data.deleted} stat events.`);
                setStatsCount(data.remaining);
                // Refresh oldest stat
                const configRes = await fetch('/api/admin/config');
                if (configRes.ok) {
                    const configData: ConfigData = await configRes.json();
                    setOldestStat(configData.oldestStat ?? null);
                }
            } else {
                alert('Failed to purge stats');
            }
        } catch (e) {
            console.error(e);
            alert('Error purging stats');
        } finally {
            setPurging(false);
        }
    };

    if (loading) {
        return <div className="text-stone-500">Loading configuration...</div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <header>
                <h2 className="text-3xl font-bold text-stone-900">System Configuration</h2>
                <p className="text-stone-500 mt-2">Manage application settings and maintenance tasks.</p>
            </header>

            {/* Threshold Configuration */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-bold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">⚙️</span>
                    Adoption Threshold Settings
                </h3>
                <p className="text-sm text-stone-500 mb-4">
                    Configure the threshold for flagging adopters with "too many adoptions".
                </p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-1">Max Adoptions</label>
                        <input
                            type="number"
                            value={config.too_many_adoptions_threshold}
                            onChange={(e) => setConfig({ ...config, too_many_adoptions_threshold: e.target.value })}
                            className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                            min="1"
                        />
                        <span className="text-xs text-stone-400">adoptions</span>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-1">Time Period</label>
                        <input
                            type="number"
                            value={config.too_many_adoptions_period_days}
                            onChange={(e) => setConfig({ ...config, too_many_adoptions_period_days: e.target.value })}
                            className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                            min="1"
                        />
                        <span className="text-xs text-stone-400">days</span>
                    </div>
                </div>

                {/* Adoption Requests Threshold */}
                <div className="mt-6 pt-6 border-t border-stone-200">
                    <h4 className="text-md font-bold text-stone-800 mb-2 flex items-center gap-2">
                        <span>📋</span>
                        Adoption Requests Threshold
                    </h4>
                    <p className="text-sm text-stone-500 mb-4">
                        Configure the threshold for flagging adopters with too many adoption requests.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-stone-700 mb-1">Max Requests</label>
                            <input
                                type="number"
                                value={config.too_many_requests_threshold}
                                onChange={(e) => setConfig({ ...config, too_many_requests_threshold: e.target.value })}
                                className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                                min="1"
                            />
                            <span className="text-xs text-stone-400">requests</span>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-stone-700 mb-1">Time Period</label>
                            <input
                                type="number"
                                value={config.too_many_requests_period_days}
                                onChange={(e) => setConfig({ ...config, too_many_requests_period_days: e.target.value })}
                                className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                                min="1"
                            />
                            <span className="text-xs text-stone-400">days</span>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="mt-6 px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 disabled:opacity-50 transition-colors"
                >
                    {saving ? 'Saving...' : 'Save All Settings'}
                </button>
            </div>

            {/* Stats Cleanup */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-bold text-stone-900 mb-4 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    Stats Cleanup
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-stone-50 rounded-lg">
                    <div>
                        <span className="text-sm text-stone-500">Total Events</span>
                        <p className="text-2xl font-bold text-stone-900">{statsCount?.toLocaleString() ?? '—'}</p>
                    </div>
                    <div>
                        <span className="text-sm text-stone-500">Oldest Event</span>
                        <p className="text-lg font-semibold text-stone-700">
                            {oldestStat ? new Date(oldestStat).toLocaleDateString() : '—'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-bold text-stone-700 mb-1">Purge events older than</label>
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
                        className="px-6 py-2 bg-rose-500 text-white font-bold rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                        {purging ? 'Purging...' : '🗑 Purge Old Stats'}
                    </button>
                </div>
                <p className="text-xs text-stone-400 mt-2">
                    ⚠️ This action is irreversible. Purged stats cannot be recovered.
                </p>
            </div>
        </div>
    );
}
