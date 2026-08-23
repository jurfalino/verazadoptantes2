'use client';

import { useState, useRef, useMemo } from 'react';
import { formatDateTime } from '@/lib/dates';
import {
    TABLE_GROUPS,
    TABLE_MANIFEST,
    defaultSelectionFromManifest,
    tablesInGroup,
    type TableGroupKey,
} from '@/lib/dataMigrationManifest';

interface ImportResult {
    success: boolean;
    mode: string;
    summary: Record<string, { inserted: number; failed: number; skipped: number }>;
    errors: Array<{ table: string; error: string }>;
    importedAt: string;
    importedBy: string;
}

interface ExportPreview {
    version: string;
    exportedAt: string;
    exportedBy: string;
    tables: Record<string, unknown[]>;
}

export default function DataMigrationPage() {
    // ─── Export state ──────────────────────────────────
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [exportSelected, setExportSelected] = useState<Set<string>>(
        () => new Set(defaultSelectionFromManifest())
    );

    // ─── Import state ──────────────────────────────────
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [preview, setPreview] = useState<ExportPreview | null>(null);
    const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
    const [dragOver, setDragOver] = useState(false);
    const [confirmReplace, setConfirmReplace] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const fileDataRef = useRef<ExportPreview | null>(null);

    // ─── Export: download ──────────────────────────────
    const handleExport = async () => {
        setExporting(true);
        setExportError('');
        try {
            const res = await fetch('/api/admin/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tables: Array.from(exportSelected) }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
                throw new Error(errBody.error || `Export failed: ${res.statusText}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const disposition = res.headers.get('Content-Disposition');
            const filename = disposition?.match(/filename="(.+)"/)?.[1] || 'export.json';
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: unknown) {
            setExportError(e instanceof Error ? e.message : 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    // ─── Import: file ──────────────────────────────────
    const handleFile = async (file: File) => {
        setImportError('');
        setImportResult(null);
        setPreview(null);
        setConfirmReplace(false);

        try {
            const text = await file.text();
            const data = JSON.parse(text) as ExportPreview;

            if (!data.version || !data.tables) {
                throw new Error('Invalid file: missing version or tables');
            }

            fileDataRef.current = data;
            setPreview(data);

            // Default selection on import = every key present in the file that
            // we recognise AND whose group is on-by-default.
            const fileKeys = new Set(Object.keys(data.tables));
            const recognised = TABLE_MANIFEST.filter(t => fileKeys.has(t.key));
            const onByDefault = new Set(TABLE_GROUPS.filter(g => g.defaultOn).map(g => g.key));
            setImportSelected(new Set(
                recognised.filter(t => onByDefault.has(t.group)).map(t => t.key)
            ));
        } catch (e: unknown) {
            setImportError(e instanceof Error ? e.message : 'Failed to read file');
        }
    };

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    // ─── Import: execute ───────────────────────────────
    const handleImport = async () => {
        if (!fileDataRef.current) return;

        if (importMode === 'replace' && !confirmReplace) {
            setConfirmReplace(true);
            return;
        }

        setImporting(true);
        setImportError('');
        setImportResult(null);

        try {
            const payload = {
                ...fileDataRef.current,
                mode: importMode,
                selectedTables: Array.from(importSelected),
            };
            const res = await fetch('/api/admin/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result: ImportResult & { error?: string } = await res.json();
            if (!res.ok) throw new Error(result.error || 'Import failed');

            setImportResult(result);
            setPreview(null);
            fileDataRef.current = null;
            setImportSelected(new Set());
            if (fileRef.current) fileRef.current.value = '';
        } catch (e: unknown) {
            setImportError(e instanceof Error ? e.message : 'Import failed');
        } finally {
            setImporting(false);
            setConfirmReplace(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-semibold text-stone-900">📦 Data Migration</h1>
                <p className="text-sm text-stone-500 mt-1">Export and import data between environments</p>
            </div>

            {/* ─── EXPORT SECTION ─── */}
            <section className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-lg font-semibold text-stone-800 mb-2">Export Data</h2>
                <p className="text-sm text-stone-500 mb-4">
                    Choose which entity groups to include, then download the JSON.
                </p>

                <TableSelector
                    selected={exportSelected}
                    onChange={setExportSelected}
                    availableKeys={null}
                />

                <button
                    onClick={handleExport}
                    disabled={exporting || exportSelected.size === 0}
                    className="mt-4 px-5 py-2.5 bg-stone-900 text-white rounded-lg font-medium text-sm hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {exporting ? '⏳ Exporting...' : `⬇️ Download Export (${exportSelected.size} table${exportSelected.size === 1 ? '' : 's'})`}
                </button>
                {exportError && (
                    <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{exportError}</p>
                )}
            </section>

            {/* ─── IMPORT SECTION ─── */}
            <section className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-lg font-semibold text-stone-800 mb-2">Import Data</h2>
                <p className="text-sm text-stone-500 mb-4">
                    Upload an export file. After upload you can pick which entity groups to actually import.
                </p>

                {/* Mode selector */}
                <div className="flex gap-3 mb-4">
                    <button
                        onClick={() => { setImportMode('merge'); setConfirmReplace(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border-2 transition-all ${importMode === 'merge'
                            ? 'border-teal-500 bg-teal-50 text-teal-700'
                            : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                    >
                        <div className="font-semibold">🔀 Merge</div>
                        <div className="text-xs mt-0.5 opacity-75">Add new records, update existing ones (matched by primary key)</div>
                    </button>
                    <button
                        onClick={() => { setImportMode('replace'); setConfirmReplace(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border-2 transition-all ${importMode === 'replace'
                            ? 'border-red-500 bg-red-50 text-red-700'
                            : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                    >
                        <div className="font-semibold">🔄 Replace</div>
                        <div className="text-xs mt-0.5 opacity-75">Delete the SELECTED tables, then import. Other tables untouched.</div>
                    </button>
                </div>

                {/* Drop zone */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-stone-300 hover:border-stone-400 hover:bg-stone-50'
                        }`}
                >
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".json"
                        onChange={onFileChange}
                        className="hidden"
                    />
                    <div className="text-3xl mb-2">📄</div>
                    <p className="text-sm text-stone-600 font-medium">Drop JSON file here or click to browse</p>
                    <p className="text-xs text-stone-500 mt-1">Only .json export files are accepted</p>
                </div>

                {/* Preview + selection */}
                {preview && (
                    <div className="mt-4 bg-stone-50 rounded-xl border border-stone-200 p-4">
                        <h3 className="font-semibold text-stone-800 text-sm mb-1">📋 File preview</h3>
                        <p className="text-xs text-stone-500 mb-3">
                            Exported {formatDateTime(new Date(preview.exportedAt))} by {preview.exportedBy} · version {preview.version}
                        </p>

                        <TableSelector
                            selected={importSelected}
                            onChange={setImportSelected}
                            availableKeys={new Set(Object.keys(preview.tables))}
                            rowCounts={Object.fromEntries(
                                Object.entries(preview.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
                            )}
                        />

                        {/* Import button */}
                        <div className="mt-4 flex items-center gap-3">
                            {confirmReplace ? (
                                <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3">
                                    <p className="text-sm text-red-700 font-medium mb-2">
                                        ⚠️ This will DELETE the {importSelected.size} selected table{importSelected.size === 1 ? '' : 's'} before importing. Are you sure?
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleImport}
                                            disabled={importing}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                                        >
                                            {importing ? '⏳ Importing...' : '🗑️ Yes, replace selected'}
                                        </button>
                                        <button
                                            onClick={() => setConfirmReplace(false)}
                                            className="px-4 py-2 bg-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-300"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={handleImport}
                                    disabled={importing || importSelected.size === 0}
                                    className={`px-5 py-2.5 rounded-lg font-medium text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${importMode === 'replace'
                                        ? 'bg-red-600 hover:bg-red-700'
                                        : 'bg-teal-600 hover:bg-teal-700'
                                        }`}
                                >
                                    {importing
                                        ? '⏳ Importing...'
                                        : importMode === 'replace'
                                            ? `🔄 Replace selected (${importSelected.size})`
                                            : `🔀 Merge selected (${importSelected.size})`
                                    }
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Import result */}
                {importResult && (
                    <div className={`mt-4 rounded-xl border p-4 ${importResult.success ? 'bg-teal-50 border-teal-200' : 'bg-amber-50 border-amber-200'}`}>
                        <h3 className={`font-semibold text-sm mb-1 ${importResult.success ? 'text-teal-800' : 'text-amber-800'}`}>
                            {importResult.success ? '✅ Import complete' : '⚠️ Import finished with errors'}
                        </h3>
                        <p className={`text-xs mb-3 ${importResult.success ? 'text-teal-700' : 'text-amber-700'}`}>
                            Mode: {importResult.mode} · {formatDateTime(new Date(importResult.importedAt))}
                        </p>
                        <div className="grid grid-cols-1 gap-1.5">
                            {Object.entries(importResult.summary).map(([table, stat]) => (
                                <div key={table} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-stone-200 text-sm">
                                    <span className="font-mono text-xs text-stone-600">{table}</span>
                                    <span className="font-mono text-xs">
                                        <span className="text-teal-700 font-semibold">{stat.inserted} ✓</span>
                                        {stat.skipped > 0 && <span className="text-stone-500 ml-2">{stat.skipped} skipped</span>}
                                        {stat.failed > 0 && <span className="text-red-600 ml-2 font-semibold">{stat.failed} failed</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {importResult.errors.length > 0 && (
                            <details className="mt-3">
                                <summary className="text-xs font-medium text-amber-800 cursor-pointer">View {importResult.errors.length} error(s)</summary>
                                <ul className="mt-2 text-xs space-y-1 font-mono">
                                    {importResult.errors.map((err, i) => (
                                        <li key={i} className="text-amber-900">{err.table}: {err.error}</li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </div>
                )}

                {importError && (
                    <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{importError}</p>
                )}
            </section>
        </div>
    );
}

// ─── Grouped table selector ─────────────────────────────
// Shared between export and import. When `availableKeys` is null, every
// manifest table is selectable (export mode). When it's a Set, only keys
// present in the uploaded file are shown (import mode), with optional row
// counts.
interface TableSelectorProps {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    availableKeys: Set<string> | null;
    rowCounts?: Record<string, number>;
}

function TableSelector({ selected, onChange, availableKeys, rowCounts }: TableSelectorProps) {
    const visibleGroups = useMemo(() => {
        return TABLE_GROUPS.map(g => {
            const tables = tablesInGroup(g.key).filter(t => !availableKeys || availableKeys.has(t.key));
            return { group: g, tables };
        }).filter(({ tables }) => tables.length > 0);
    }, [availableKeys]);

    const toggleOne = (key: string) => {
        const next = new Set(selected);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        onChange(next);
    };

    const toggleGroup = (groupKey: TableGroupKey, on: boolean) => {
        const next = new Set(selected);
        for (const t of tablesInGroup(groupKey)) {
            if (availableKeys && !availableKeys.has(t.key)) continue;
            if (on) next.add(t.key);
            else next.delete(t.key);
        }
        onChange(next);
    };

    return (
        <div className="space-y-3">
            {visibleGroups.map(({ group, tables }) => {
                const allOn = tables.every(t => selected.has(t.key));
                const someOn = tables.some(t => selected.has(t.key));
                return (
                    <div key={group.key} className="border border-stone-200 rounded-lg overflow-hidden">
                        <label className="flex items-start gap-3 px-3 py-2.5 bg-stone-50 cursor-pointer hover:bg-stone-100">
                            <input
                                type="checkbox"
                                checked={allOn}
                                ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                                onChange={(e) => toggleGroup(group.key, e.target.checked)}
                                className="mt-1 h-4 w-4"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-stone-800">{group.label}</div>
                                <div className="text-xs text-stone-500 mt-0.5">{group.description}</div>
                            </div>
                        </label>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-2 bg-white">
                            {tables.map(t => (
                                <label key={t.key} className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-stone-50 rounded">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(t.key)}
                                        onChange={() => toggleOne(t.key)}
                                        className="h-3.5 w-3.5"
                                    />
                                    <span className="flex-1 truncate text-stone-700">{t.label}</span>
                                    {rowCounts && (
                                        <span className="font-mono text-stone-500">{rowCounts[t.key] ?? 0}</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
