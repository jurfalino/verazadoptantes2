'use client';

/**
 * "Datos compartidos": phones, emails and documents on 2+ live profiles —
 * exactly who an exact API call can answer "ambiguous" for. Read-only list;
 * the fix is on the profiles (merge them, or leave a family's shared phone).
 */
import Link from 'next/link';
import type { SharedIdentifierGroup } from '@/domain/sharedIdentifiers';

const FIELD_LABEL: Record<SharedIdentifierGroup['field'], string> = { phone: 'Teléfono', email: 'Email', documentId: 'Documento' };

export default function SharedIdentifiersPanel({ groups }: { groups: SharedIdentifierGroup[] }) {
    return (
        <div data-testid="shared-identifiers">
            <p className="text-sm text-stone-500 mb-4">
                Teléfonos, emails y documentos que están en más de un perfil. Una búsqueda exacta por API con ese dato puede
                responder «ambiguous». Si es la misma persona, fusioná los perfiles; si son personas distintas (por ejemplo,
                un teléfono familiar), está bien así.
            </p>
            {groups.length === 0 ? (
                <div className="text-center text-sm text-stone-500 bg-white border border-stone-200 rounded-xl py-10">
                    Ningún dato de contacto está en más de un perfil.
                </div>
            ) : (
                <div className="space-y-2.5">
                    {groups.map(g => (
                        <div key={`${g.field}|${g.value}`} data-testid="shared-identifier" className="bg-white border border-stone-200 rounded-xl p-4">
                            <div className="flex gap-2 items-center flex-wrap mb-2">
                                <span className="text-xs font-semibold text-stone-500">{FIELD_LABEL[g.field]}</span>
                                <span className="text-sm font-semibold text-stone-900 break-all">{g.value}</span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">{g.profiles.length} perfiles</span>
                                {g.sameName
                                    ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }}>Mismo nombre: posible duplicado</span>
                                    : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">Nombres distintos</span>}
                            </div>
                            <ul className="flex flex-wrap gap-x-4 gap-y-1">
                                {g.profiles.map(p => (
                                    <li key={p.id} className="min-w-0">
                                        <Link href={`/adopter/${p.id}`} target="_blank" className="text-sm font-semibold text-teal-700 hover:underline break-words">
                                            {p.name || <span className="italic text-stone-400">Sin nombre</span>}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
