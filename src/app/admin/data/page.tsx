'use client';

import { useState, useRef } from 'react';

interface ImportSummary {
    success: boolean;
    mode: string;
    summary: Record<string, number>;
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
    // Export state
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');

    // Import state
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');
    const [importResult, setImportResult] = useState<ImportSummary | null>(null);
    const [preview, setPreview] = useState<ExportPreview | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [confirmReplace, setConfirmReplace] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const fileDataRef = useRef<ExportPreview | null>(null);

    // ─── Export ───────────────────────────────────────
    const handleExport = async () => {
        setExporting(true);
        setExportError('');
        try {
            const res = await fetch('/api/admin/export');
            if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);

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

    // ─── Import: File Selection ──────────────────────
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

    // ─── Import: Execute ─────────────────────────────
    const handleImport = async () => {
        if (!fileDataRef.current) return;

        // Safety check for replace mode
        if (importMode === 'replace' && !confirmReplace) {
            setConfirmReplace(true);
            return;
        }

        setImporting(true);
        setImportError('');
        setImportResult(null);

        try {
            const payload = { ...fileDataRef.current, mode: importMode };
            const res = await fetch('/api/admin/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result: ImportSummary & { error?: string } = await res.json();
            if (!res.ok) throw new Error(result.error || 'Import failed');

            setImportResult(result);
            setPreview(null);
            fileDataRef.current = null;
            if (fileRef.current) fileRef.current.value = '';
        } catch (e: unknown) {
            setImportError(e instanceof Error ? e.message : 'Import failed');
        } finally {
            setImporting(false);
            setConfirmReplace(false);
        }
    };

    const TABLE_LABELS: Record<string, string> = {
        adopters: '👤 Adopters',
        adoptions: '🐾 Adoptions',
        adopter_images: '🖼️ Adopter Images',
        adoption_images: '📷 Adoption Images',
        adopter_flags: '🚩 Flags',
        adopter_history: '📝 History',
        app_config: '⚙️ Config',
    };

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-stone-900">📦 Data Migration</h1>
                <p className="text-sm text-stone-500 mt-1">Export and import data between environments</p>
            </div>

            {/* ─── EXPORT SECTION ─── */}
            <section className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-lg font-semibold text-stone-800 mb-2">Export Data</h2>
                <p className="text-sm text-stone-500 mb-4">
                    Download all application data as a JSON file. Includes adopters, adoptions, images, flags, history, and config.
                </p>
                <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="px-5 py-2.5 bg-stone-900 text-white rounded-lg font-medium text-sm hover:bg-stone-800 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                    {exporting ? '⏳ Exporting...' : '⬇️ Download Export'}
                </button>
                {exportError && (
                    <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{exportError}</p>
                )}
            </section>

            {/* ─── IMPORT SECTION ─── */}
            <section className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-lg font-semibold text-stone-800 mb-2">Import Data</h2>
                <p className="text-sm text-stone-500 mb-4">
                    Upload a previously exported JSON file to import data into this environment.
                </p>

                {/* Mode selector */}
                <div className="flex gap-3 mb-4">
                    <button
                        onClick={() => { setImportMode('merge'); setConfirmReplace(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border-2 transition-all ${importMode === 'merge'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                    >
                        <div className="font-bold">🔀 Merge</div>
                        <div className="text-xs mt-0.5 opacity-75">Add new records, update existing ones</div>
                    </button>
                    <button
                        onClick={() => { setImportMode('replace'); setConfirmReplace(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border-2 transition-all ${importMode === 'replace'
                            ? 'border-red-500 bg-red-50 text-red-700'
                            : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                    >
                        <div className="font-bold">🔄 Replace</div>
                        <div className="text-xs mt-0.5 opacity-75">Delete ALL existing data, then import</div>
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
                    <p className="text-xs text-stone-400 mt-1">Only .json export files are accepted</p>
                </div>

                {/* Preview */}
                {preview && (
                    <div className="mt-4 bg-stone-50 rounded-xl border border-stone-200 p-4">
                        <h3 className="font-semibold text-stone-800 text-sm mb-1">📋 File Preview</h3>
                        <p className="text-xs text-stone-500 mb-3">
                            Exported {new Date(preview.exportedAt).toLocaleString()} by {preview.exportedBy}
                        </p>

                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(preview.tables).map(([table, rows]) => (
                                <div key={table} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-stone-100">
                                    <span className="text-sm">{TABLE_LABELS[table] || table}</span>
                                    <span className="text-sm font-mono font-bold text-stone-700">
                                        {Array.isArray(rows) ? rows.length : 0}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Import button */}
                        <div className="mt-4 flex items-center gap-3">
                            {confirmReplace ? (
                                <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3">
                                    <p className="text-sm text-red-700 font-medium mb-2">
                                        ⚠️ This will DELETE all existing data before importing. Are you sure?
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleImport}
                                            disabled={importing}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50"
                                        >
                                            {importing ? '⏳ Importing...' : '🗑️ Yes, Replace All'}
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
                                    disabled={importing}
                                    className={`px-5 py-2.5 rounded-lg font-medium text-sm text-white disabled:opacity-50 disabled:cursor-wait transition-colors ${importMode === 'replace'
                                        ? 'bg-red-600 hover:bg-red-700'
                                        : 'bg-emerald-600 hover:bg-emerald-700'
                                        }`}
                                >
                                    {importing
                                        ? '⏳ Importing...'
                                        : importMode === 'replace'
                                            ? '🔄 Replace All Data'
                                            : '🔀 Merge Data'
                                    }
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Import result */}
                {importResult && (
                    <div className="mt-4 bg-emerald-50 rounded-xl border border-emerald-200 p-4">
                        <h3 className="font-semibold text-emerald-800 text-sm mb-1">✅ Import Complete</h3>
                        <p className="text-xs text-emerald-600 mb-3">
                            Mode: {importResult.mode} • {new Date(importResult.importedAt).toLocaleString()}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(importResult.summary).map(([table, count]) => (
                                <div key={table} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-emerald-100">
                                    <span className="text-sm">{TABLE_LABELS[table] || table}</span>
                                    <span className="text-sm font-mono font-bold text-emerald-700">{count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {importError && (
                    <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{importError}</p>
                )}
            </section>
        </div>
    );
}
