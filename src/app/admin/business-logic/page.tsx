/**
 * Admin-only reference page documenting the platform's business logic.
 *
 * Lives under /admin/* so the layout's `isAdminAsync` gate covers auth —
 * the page itself is a stateless server component. Intentionally static:
 * this is the canonical "how do roles + permissions actually work" doc,
 * not a dashboard. Update this file whenever you ship a change that
 * shifts a permission gate or adds a new role.
 *
 * Tone: Spanish-first (matches the rest of the admin UI). Concise. The
 * permission matrix is the highest-value bit — scan top-to-bottom in
 * under a minute.
 */
export const runtime = 'edge';

type Role = 'visitor' | 'contributor' | 'orig_contrib' | 'editor' | 'org_mate' | 'owner' | 'moderator' | 'admin';

const ROLE_LABELS: Record<Role, { label: string; tone: string }> = {
    visitor: { label: 'Visitante', tone: 'bg-stone-100 text-stone-700' },
    contributor: { label: 'Contribuidor', tone: 'bg-stone-100 text-stone-700' },
    orig_contrib: { label: 'Contribuidor original', tone: 'bg-blue-50 text-blue-700' },
    editor: { label: 'Editor', tone: 'bg-blue-50 text-blue-700' },
    org_mate: { label: 'Compañero de org.', tone: 'bg-teal-50 text-teal-700' },
    owner: { label: 'Dueño/a', tone: 'bg-teal-50 text-teal-700' },
    moderator: { label: 'Moderador', tone: 'bg-teal-100 text-teal-800' },
    admin: { label: 'Admin', tone: 'bg-purple-100 text-purple-800' },
};

interface Capability {
    action: string;
    description?: string;
    roles: Partial<Record<Role, boolean | string>>;
}

const ROW_ORDER: Role[] = ['visitor', 'contributor', 'orig_contrib', 'editor', 'org_mate', 'owner', 'moderator', 'admin'];

const CAPABILITIES: Capability[] = [
    {
        action: 'Ver perfil en búsqueda',
        roles: { visitor: true, contributor: true, orig_contrib: true, editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Ver contacto sin máscara',
        description: 'PII (teléfono, email, dirección, ID). Equivale al estado "privilegiado" en el resolver.',
        roles: { visitor: false, contributor: 'sólo con grant', orig_contrib: 'sólo con grant', editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Ver "Quién tiene acceso"',
        description: 'Lista de grants activos sobre el perfil + botón de revocar. Mismo gate que ver contacto sin máscara.',
        roles: { editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Aprobar/denegar pedidos de acceso PII',
        roles: { editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Agregar entrada de contacto (modelo abierto)',
        description: 'addContactEntry. Cualquier usuario autenticado puede aportar.',
        roles: { contributor: true, orig_contrib: true, editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Editar/borrar entrada propia',
        description: 'updateContactEntry / removeContactEntry sobre una entry cuyo addedBy es el actor.',
        roles: { orig_contrib: true, editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Editar/borrar cualquier entrada de contacto',
        roles: { org_mate: true, owner: true, admin: true },
    },
    {
        action: 'Editar campos del registro (nombre, status, familia, dirección)',
        description: 'saveAdopter. Bloquea contributors aunque el flag PII esté apagado.',
        roles: { org_mate: true, owner: true, admin: true },
    },
    {
        action: 'Agregar actividad / foto',
        description: 'saveAdoption / saveImage. Abierto pero genera notificación al dueño.',
        roles: { contributor: true, orig_contrib: true, editor: true, org_mate: true, owner: true, moderator: true, admin: true },
    },
    {
        action: 'Cambiar foto de perfil',
        roles: { org_mate: true, owner: true, admin: true },
    },
    {
        action: 'Ver historial de auditoría del perfil',
        description: 'CollapsibleSection al final de /adopter/[id].',
        roles: { org_mate: true, moderator: true, admin: true },
    },
    {
        action: 'Eliminar (soft) el registro',
        description: 'Borrado destructivo — único gate que NO se relaja para org-mates por diseño.',
        roles: { owner: true, admin: true },
    },
    {
        action: 'Transferir propiedad del registro',
        description: 'Sólo desde el perfil. Reescribe adopters.addedBy con audit-first.',
        roles: { admin: true },
    },
    {
        action: 'Cambiar visibilidad pública del registro',
        description: 'setAdopterPublic — override admin sobre ENABLE_PUBLIC_PROFILES.',
        roles: { admin: true },
    },
    {
        action: 'Marcar otro usuario como moderador',
        description: 'Vía /admin/users. La opción "moderator" otorga lectura privilegiada global sin permisos de escritura admin.',
        roles: { admin: true },
    },
    {
        action: 'Eliminar adoptante (hard) / purgar datos / correr SQL',
        roles: { admin: true },
    },
];

function Cell({ value }: { value: boolean | string | undefined }) {
    if (value === true) {
        return <span className="text-emerald-600 font-bold" aria-label="sí">✓</span>;
    }
    if (typeof value === 'string') {
        return <span className="text-amber-600 text-[10px] font-medium" title={value}>{value}</span>;
    }
    return <span className="text-stone-300" aria-label="no">—</span>;
}

function RoleBadge({ role }: { role: Role }) {
    const info = ROLE_LABELS[role];
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${info.tone}`}>
            {info.label}
        </span>
    );
}

export default async function BusinessLogicPage() {
    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-bold text-stone-800">Lógica de negocio</h1>
                <p className="text-sm text-stone-600">
                    Referencia interna. Quién puede hacer qué, cuándo se enmascara la PII, qué dispara una notificación.
                    Actualizá esta página cuando muevas un gate.
                </p>
            </header>

            {/* ── Roles ───────────────────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Roles</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-sm text-stone-700">
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="visitor" />
                        <span>No autenticado o autenticado sin contexto compartido con el perfil.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="contributor" />
                        <span>Cualquier usuario autenticado. El modelo de contribución abierta le deja aportar datos pero no editar lo existente.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="orig_contrib" />
                        <span>Sobre una entry específica: <code className="text-xs bg-stone-100 px-1 rounded">entry.addedBy === actor</code>. Gate por entry, no global.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="editor" />
                        <span>Tiene al menos una fila en <code className="text-xs bg-stone-100 px-1 rounded">adopter_history</code> con <code className="text-xs bg-stone-100 px-1 rounded">kind=&apos;edit&apos;</code> sobre este perfil. Las contribuciones (<code className="text-xs bg-stone-100 px-1 rounded">kind=&apos;contribution&apos;</code>) no cuentan.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="org_mate" />
                        <span>Comparte al menos una organización con <code className="text-xs bg-stone-100 px-1 rounded">adopter.addedBy</code>. Resuelto por <code className="text-xs bg-stone-100 px-1 rounded">isOrgMate(viewer, owner)</code>.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="owner" />
                        <span><code className="text-xs bg-stone-100 px-1 rounded">adopter.addedBy === viewer</code>. Quien creó el registro.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="moderator" />
                        <span><code className="text-xs bg-stone-100 px-1 rounded">user_profiles.role = &apos;moderator&apos;</code>. Lectura privilegiada global, sin permisos admin de escritura.</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RoleBadge role="admin" />
                        <span>Email en <code className="text-xs bg-stone-100 px-1 rounded">BOOTSTRAP_ADMIN_EMAILS</code> o <code className="text-xs bg-stone-100 px-1 rounded">user_profiles.role = &apos;admin&apos;</code>. Todos los permisos.</span>
                    </div>
                </div>
            </section>

            {/* ── Matriz de permisos ──────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Matriz de permisos</h2>
                <p className="text-xs text-stone-500">
                    Para cada perfil dado, el verificador debe satisfacer al menos un rol con ✓ en esa fila. Los roles
                    son acumulativos a derecha — un dueño tiene todo lo del editor, un admin tiene todo.
                </p>

                <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-stone-50 border-b border-stone-200">
                            <tr>
                                <th className="text-left px-3 py-2 font-semibold text-stone-700 w-[34%]">Acción</th>
                                {ROW_ORDER.map(r => (
                                    <th key={r} className="px-2 py-2 text-center align-bottom">
                                        <div className="rotate-[-25deg] origin-bottom inline-block text-xs font-medium text-stone-600 whitespace-nowrap">
                                            {ROLE_LABELS[r].label}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {CAPABILITIES.map((cap, i) => (
                                <tr key={cap.action} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50/40'}>
                                    <td className="px-3 py-2 align-top">
                                        <div className="font-medium text-stone-800">{cap.action}</div>
                                        {cap.description && (
                                            <div className="text-[11px] text-stone-500 mt-0.5">{cap.description}</div>
                                        )}
                                    </td>
                                    {ROW_ORDER.map(role => (
                                        <td key={role} className="text-center px-2 py-2 align-top">
                                            <Cell value={cap.roles[role]} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── PII gating ──────────────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Enmascaramiento PII</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-sm text-stone-700">
                    <p>
                        Bandera global <code className="text-xs bg-stone-100 px-1 rounded">ENABLE_PII_ACCESS_GATING</code>.
                        Si está apagada, no se enmascara nada. Si está prendida (caso normal en prod),
                        <code className="text-xs bg-stone-100 px-1 rounded mx-1">resolveVisibility</code> calcula 3 niveles:
                    </p>
                    <ul className="space-y-2 list-disc pl-5">
                        <li><strong>full</strong> — todo visible. Aplica a privilegiados (dueño / admin / moderador / editor / org-mate).</li>
                        <li><strong>partial</strong> — algunos campos se ven (grants <code className="text-xs bg-stone-100 px-1 rounded">all_contact</code> ⇒ todo el contacto; grants <code className="text-xs bg-stone-100 px-1 rounded">entry</code> ⇒ entries específicas; grants <code className="text-xs bg-stone-100 px-1 rounded">name_token</code> ⇒ tokens de nombre matcheados).</li>
                        <li><strong>none</strong> — todo enmascarado. Contributor sin grants.</li>
                    </ul>
                    <p>
                        Search-match grants (<code className="text-xs bg-stone-100 px-1 rounded">grantSearchMatchAccess</code>) se ganan cuando una búsqueda
                        coincide con campos específicos del perfil — desbloquean sólo esos campos para ese viewer, no el resto del registro.
                        Aparecen en "Quién tiene acceso" como un conteo agregado, no listadas individualmente, porque el viewer las puede re-ganar buscando.
                    </p>
                </div>
            </section>

            {/* ── Colaboración org. ──────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Colaboración entre organizaciones</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-sm text-stone-700">
                    <p>
                        La <strong>organización es la frontera de confianza</strong>. Dos personas que comparten una org se tratan como co-dueños
                        para todo gate (lectura PII, edición, "Quién tiene acceso", historial de auditoría).
                        El registro de auditoría + las notificaciones al dueño son el respaldo de "confiar pero verificar"
                        que hace seguros los gates más relajados.
                    </p>
                    <p>
                        Carve-out único: <strong>borrar el registro queda en owner+admin</strong>. Es la acción destructiva donde
                        auditar después no sirve.
                    </p>
                    <p>
                        El chip de "Creada por X · Org Y" debajo del nombre privilegia mostrar la org compartida con quien mira
                        (acento teal) por sobre la org primaria del creador. Visitantes ven sólo el nombre, no la org —
                        no queremos filtrar pertenencia de organización a quien no comparte contexto.
                    </p>
                </div>
            </section>

            {/* ── Notificaciones ─────────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Notificaciones al dueño</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-sm text-stone-700">
                    <p>
                        Tipo <code className="text-xs bg-stone-100 px-1 rounded">profile_edited_by_orgmate</code>. Se dispara cuando alguien
                        que no es el dueño modifica un perfil propiedad del dueño.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                            <div className="font-semibold text-emerald-800 text-xs uppercase tracking-wider mb-2">Dispara</div>
                            <ul className="space-y-1 list-disc pl-4 text-xs">
                                <li><code className="bg-stone-100 px-1 rounded">saveAdopter</code> (edición de campos)</li>
                                <li><code className="bg-stone-100 px-1 rounded">updateContactEntry</code></li>
                                <li><code className="bg-stone-100 px-1 rounded">removeContactEntry</code></li>
                                <li><code className="bg-stone-100 px-1 rounded">saveAdoption</code> (alta de actividad)</li>
                                <li><code className="bg-stone-100 px-1 rounded">saveImage</code> (alta de foto)</li>
                                <li><code className="bg-stone-100 px-1 rounded">setProfilePicture</code></li>
                            </ul>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                            <div className="font-semibold text-stone-700 text-xs uppercase tracking-wider mb-2">No dispara</div>
                            <ul className="space-y-1 list-disc pl-4 text-xs">
                                <li><code className="bg-stone-100 px-1 rounded">addContactEntry</code> — contribución abierta, sería ruido</li>
                                <li>El propio dueño editando lo suyo</li>
                                <li>Editor con email "anonymous"</li>
                                <li>Perfil sin dueño addressable</li>
                            </ul>
                        </div>
                    </div>
                    <p>
                        Dedup determinístico por ventana de 30 min: la misma tupla
                        <code className="text-xs bg-stone-100 px-1 rounded mx-1">(dueño, adopterId, editor, bucket)</code>
                        genera UNA fila. Edits subsiguientes UPSERT-ean el body con el último resumen y bumpean
                        <code className="text-xs bg-stone-100 px-1 rounded mx-1">createdAt</code> para que la campana
                        re-suba el item al tope. El body NUNCA contiene PII — sólo nombres de campos.
                    </p>
                </div>
            </section>

            {/* ── Login gate ─────────────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Gate de login para adoptantes</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-sm text-stone-700">
                    <p>
                        En <code className="text-xs bg-stone-100 px-1 rounded">src/lib/adopterLoginGate.ts</code>, NextAuth corre el gate
                        en cada sign-in. Rechaza el login si el email coincide con un perfil que cumple cualquiera de:
                    </p>
                    <ul className="space-y-1 list-disc pl-5">
                        <li><code className="text-xs bg-stone-100 px-1 rounded">avgRating &lt; 4</code></li>
                        <li><code className="text-xs bg-stone-100 px-1 rounded">tooManyAdoptions</code> (config en <code className="text-xs bg-stone-100 px-1 rounded">app_config</code>)</li>
                        <li><code className="text-xs bg-stone-100 px-1 rounded">tooManyRequests</code></li>
                    </ul>
                    <p>
                        Admins se saltean el gate (<code className="text-xs bg-stone-100 px-1 rounded">isAdminAsync</code>). Si el match es contra
                        un perfil que el propio actor creó (self-added), no cuenta — los rescatistas pueden crear perfiles
                        propios sin auto-bloquearse. Falla abierto en error de D1.
                    </p>
                    <p>
                        Los bloqueos van a <code className="text-xs bg-stone-100 px-1 rounded">blocked_logins</code> y notifican a admins.
                        El usuario rebota a <code className="text-xs bg-stone-100 px-1 rounded">/auth-error</code> con copy intencionalmente
                        vago para no revelar la causa al adoptante bloqueado.
                    </p>
                </div>
            </section>

            {/* ── Acciones admin-only ─────────────────────────────────────── */}
            <section className="space-y-3">
                <h2 className="text-lg font-bold text-stone-800">Acciones reservadas a admin</h2>
                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-2 text-sm text-stone-700">
                    <ul className="space-y-1 list-disc pl-5">
                        <li>Transferir propiedad (<code className="text-xs bg-stone-100 px-1 rounded">transferAdopterOwnership</code>). Audit-first; reescribe sólo <code className="text-xs bg-stone-100 px-1 rounded">adopters.addedBy</code>, no los <code className="text-xs bg-stone-100 px-1 rounded">addedBy</code> de filas hijas.</li>
                        <li>Hard-delete (<code className="text-xs bg-stone-100 px-1 rounded">deleteAdopter</code>). Cascade sobre stats/flags/history/images/adoptions/tokens.</li>
                        <li>Purga global (<code className="text-xs bg-stone-100 px-1 rounded">purgeAllData</code>). Requiere código de confirmación.</li>
                        <li>Marcar perfil como público (<code className="text-xs bg-stone-100 px-1 rounded">setAdopterPublic</code>). Override sobre el flag <code className="text-xs bg-stone-100 px-1 rounded">ENABLE_PUBLIC_PROFILES</code>.</li>
                        <li>Consola SQL (read-only) en <code className="text-xs bg-stone-100 px-1 rounded">/admin/query</code>. Sólo SELECT; bloquea multi-statement y keywords destructivas.</li>
                        <li>Backfill de <code className="text-xs bg-stone-100 px-1 rounded">contactEntries</code> desde el blob legacy.</li>
                        <li>Cambiar el rol de un usuario (viewer/contributor/moderator/admin) desde <code className="text-xs bg-stone-100 px-1 rounded">/admin/users</code>.</li>
                    </ul>
                </div>
            </section>

            <footer className="text-xs text-stone-400 pt-4 border-t border-stone-200">
                Si moviste un gate, sumá una fila acá. La fuente de verdad sigue siendo el código —
                este doc existe para que un humano nuevo pueda mapearse en 5 minutos.
            </footer>
        </div>
    );
}
