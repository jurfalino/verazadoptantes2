'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface AnimalImage {
    id: string;
    url: string;
    caption: string | null;
}

interface AnimalData {
    id: string;
    animalName: string;
    species: string | null;
    details: string | null;
    comments: string | null;
    rescuerName: string | null;
    images: AnimalImage[];
}

export default function ContractPage() {
    const { id } = useParams<{ id: string }>();
    const [animal, setAnimal] = useState<AnimalData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState({
        name: '',
        lastName: '',
        dni: '',
        email: '',
        phone: '',
        address: '',
        socialNetworks: '',
        locality: '',
    });

    useEffect(() => {
        async function load() {
            try {
                const animalRes = await fetch(`/api/contract/${id}`);
                if (!animalRes.ok) {
                    setError(animalRes.status === 404 ? 'Animal no encontrado' : 'Error al cargar');
                    return;
                }
                const animalData = await animalRes.json() as AnimalData;
                setAnimal(animalData);
            } catch {
                setError('Error al cargar los datos del contrato');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/contract/${id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (res.ok) {
                setSubmitted(true);
            } else {
                const data = await res.json();
                setError((data as { error: string }).error || 'Error al enviar');
            }
        } catch {
            setError('Error de red');
        } finally {
            setSubmitting(false);
        }
    };

    // Reusable inline input that looks like a blank line in a legal document
    const blank = (
        name: keyof typeof form,
        placeholder: string,
        width = 'min-w-[200px]',
        required = false,
        type = 'text'
    ) => (
        <input
            type={type}
            required={required}
            value={form[name]}
            onChange={e => setForm({ ...form, [name]: e.target.value })}
            placeholder={placeholder}
            className={`${width} border-0 border-b-2 border-stone-300 bg-transparent px-1 py-0.5 text-stone-900 font-medium placeholder-stone-300 focus:border-teal-500 focus:bg-teal-50/30 outline-none transition-all text-sm`}
        />
    );

    // Reusable static blank (no input, auto-filled from animal data)
    const staticBlank = (value: string | null | undefined, fallback = '—') => (
        <span className="border-b-2 border-stone-200 px-1 py-0.5 text-stone-900 font-medium inline-block min-w-[150px]">
            {value || fallback}
        </span>
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center">
                <div className="text-stone-500 animate-pulse text-sm">Cargando contrato...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md">
                    <div className="text-3xl mb-3">⚠️</div>
                    <h3 className="text-lg font-semibold text-stone-900 mb-2">Error</h3>
                    <p className="text-stone-500 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl p-8 text-center border border-teal-200 shadow-sm max-w-md">
                    <div className="text-5xl mb-4">🎉</div>
                    <h3 className="text-2xl font-semibold text-stone-900 mb-2">¡Adopción Registrada!</h3>
                    <p className="text-stone-500 mb-4">
                        El contrato de adopción de <strong>{animal?.animalName}</strong> ha sido enviado exitosamente.
                        El rescatista se pondrá en contacto contigo.
                    </p>
                    <div className="p-4 bg-teal-50 rounded-xl border border-teal-100 text-sm text-teal-800">
                        <p className="font-semibold mb-1">Próximos pasos:</p>
                        <ul className="text-left space-y-1">
                            <li>✅ Tus datos fueron registrados</li>
                            <li>📞 El rescatista te contactará pronto</li>
                            <li>🏠 Coordinarán una visita o entrega</li>
                        </ul>
                    </div>
                </div>
            </div>
        );
    }

    const today = new Date();
    const day = today.getDate();
    const month = today.toLocaleDateString('es-AR', { month: 'long' });
    const year = today.getFullYear();
    const speciesEmoji = animal?.species === 'cat' ? '🐱' : animal?.species === 'dog' ? '🐶' : '🐾';

    return (
        <div className="min-h-screen bg-stone-200 py-6 px-4 print:bg-white print:py-0">
            <form onSubmit={handleSubmit}>
                <div className="max-w-3xl mx-auto bg-white shadow-xl rounded-lg overflow-hidden print:shadow-none print:rounded-none" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>

                    {/* ── Animal photo banner (if available) ── */}
                    {animal?.images && animal.images.length > 0 && (
                        <div className="relative h-48 sm:h-56 bg-stone-100 overflow-hidden">
                            <img
                                src={animal.images[0].url}
                                alt={animal.animalName || 'Animal'}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                            <div className="absolute bottom-4 left-6 text-white">
                                <p className="text-2xl font-semibold drop-shadow">{speciesEmoji} {animal.animalName}</p>
                            </div>
                        </div>
                    )}

                    {/* ── Contract body ── */}
                    <div className="px-8 sm:px-12 py-10 text-sm text-stone-800 leading-relaxed space-y-6">

                        {/* Title */}
                        <h1 className="text-center text-base font-semibold tracking-wide uppercase mb-6">
                            CONTRATO DE ADOPCIÓN RESPONSABLE DE ANIMAL DE COMPAÑÍA
                        </h1>

                        {/* Date & Locality */}
                        <p>
                            En la localidad de {blank('locality', 'Ciudad / Localidad', 'min-w-[180px]')}, a los <span className="font-medium">{day}</span> días del mes de <span className="font-medium">{month}</span> de {year}, se celebra el presente contrato entre:
                        </p>

                        {/* ── EL ADOPTANTE ── */}
                        <div className="border border-stone-200 rounded-lg p-5 bg-stone-50 space-y-3">
                            <h2 className="text-xs font-semibold uppercase tracking-widest text-teal-700 mb-2">El Adoptante:</h2>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Nombre y Apellido:</span>
                                {blank('name', 'Nombre', 'min-w-[140px]', true)}
                                {blank('lastName', 'Apellido', 'min-w-[140px]', true)}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">DNI:</span>
                                {blank('dni', '12.345.678', 'min-w-[140px]')}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Domicilio Real:</span>
                                {blank('address', 'Av. Corrientes 1234, CABA', 'min-w-[300px] flex-1')}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Teléfono de contacto:</span>
                                {blank('phone', '+54 11 1234-5678', 'min-w-[180px]', false, 'tel')}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Email:</span>
                                {blank('email', 'email@ejemplo.com', 'min-w-[220px]', false, 'email')}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Redes Sociales:</span>
                                {blank('socialNetworks', '@usuario (Instagram, Facebook)', 'min-w-[250px] flex-1')}
                            </p>
                        </div>

                        {/* ── EL RESCATISTA / PROTECTORA ── */}
                        <div className="border border-stone-200 rounded-lg p-5 bg-stone-50 space-y-3">
                            <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-2">El Rescatista / Protectora:</h2>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Nombre / Institución:</span>
                                {staticBlank(animal?.rescuerName)}
                            </p>
                        </div>

                        <hr className="border-stone-200" />

                        {/* ── 1. DATOS DEL ANIMAL ── */}
                        <section>
                            <h2 className="font-semibold text-stone-900 mb-3">1. DATOS DEL ANIMAL</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4">
                                <p><span className="font-semibold">Nombre:</span> {staticBlank(animal?.animalName)}</p>
                                <p><span className="font-semibold">Especie:</span> {staticBlank(animal?.species ? `${speciesEmoji} ${animal.species}` : null)}</p>
                                <p><span className="font-semibold">Edad aprox.:</span> {staticBlank(null, '—')}</p>
                                <p><span className="font-semibold">Sexo:</span> {staticBlank(null, '—')}</p>
                                <p className="sm:col-span-2"><span className="font-semibold">Color/Señas:</span> {staticBlank(animal?.details, '—')}</p>
                                <p className="sm:col-span-2"><span className="font-semibold">N° de Microchip (si posee):</span> {staticBlank(null, '—')}</p>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* ── 2. COMPROMISOS DEL ADOPTANTE ── */}
                        <section>
                            <h2 className="font-semibold text-stone-900 mb-3">2. COMPROMISOS DEL ADOPTANTE</h2>
                            <p className="mb-3">El adoptante declara aceptar la tenencia del animal bajo las siguientes cláusulas obligatorias:</p>

                            <div className="space-y-3 pl-4">
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Bienestar y Trato:</p>
                                    <p>El animal será tratado como un miembro de la familia. Se prohíbe terminantemente mantenerlo encadenado, en balcones sin protección, en terrazas/patios sin refugio o deambulando solo por la vía pública.</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Salud:</p>
                                    <p>El adoptante se compromete a brindar asistencia veterinaria inmediata ante enfermedades o accidentes, mantener el plan de vacunación anual y la desparasitación al día.</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Esterilización:</p>
                                    <p>(Si no está castrado) El adoptante se obliga a castrar al animal al cumplir los 6 meses de edad, enviando el certificado correspondiente al rescatista. Se prohíbe su uso para cría o reproducción.</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Seguridad (Gatos):</p>
                                    <p>En caso de felinos, el adoptante garantiza que la vivienda cuenta con mallas de protección en ventanas y balcones para evitar caídas (Síndrome del gato paracaidista) o escapes.</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Prohibición de Uso Utilitario:</p>
                                    <p>El animal no podrá ser utilizado para fines de seguridad (guardia), control de plagas (caza de roedores), ni experimentos de ninguna índole.</p>
                                </div>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* ── 3. SEGUIMIENTO Y NO ABANDONO ── */}
                        <section>
                            <h2 className="font-semibold text-stone-900 mb-3">3. SEGUIMIENTO Y NO ABANDONO</h2>
                            <div className="space-y-3 pl-4">
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Seguimiento:</p>
                                    <p>El adoptante acepta recibir visitas programadas y enviar fotos/videos periódicos del animal para constatar su estado de salud y adaptación.</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Prohibición de Cesión:</p>
                                    <p>Si por razones de fuerza mayor el adoptante no pudiera continuar con la tenencia, está estrictamente prohibido regalarlo, venderlo o abandonarlo. Deberá comunicarse inmediatamente con el rescatista para coordinar el retorno del animal o una nueva adopción supervisada.</p>
                                </div>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* ── 4. INCUMPLIMIENTO Y LEY 14.346 ── */}
                        <section>
                            <h2 className="font-semibold text-stone-900 mb-3">4. INCUMPLIMIENTO Y LEY 14.346</h2>
                            <p className="pl-4">El incumplimiento de cualquiera de estas cláusulas facultará al rescatista a la restitución inmediata del animal sin necesidad de intervención judicial previa, sin perjuicio de las acciones legales que correspondan bajo la Ley Nacional 14.346 de Protección Animal, la cual pena el maltrato y la crueldad.</p>
                        </section>

                        <hr className="border-stone-200" />

                        {/* ── 5. CONSENTIMIENTO ── */}
                        <section>
                            <h2 className="font-semibold text-stone-900 mb-3">5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO</h2>
                            <p className="pl-4">El Adoptante presta su consentimiento expreso para que los datos personales consignados en este contrato sean incorporados a los registros internos del Rescatista y a bases de datos compartidas entre organizaciones de protección animal debidamente acreditadas.</p>
                        </section>

                        <hr className="border-stone-300 border-t-2 my-8" />

                        {/* ── Signatures ── */}
                        <section className="flex flex-col sm:flex-row justify-between gap-8 mt-8">
                            <div className="text-center flex-1">
                                <div className="border-b-2 border-stone-400 h-12 mb-2 flex items-end justify-center pb-1 text-stone-500 italic text-sm">
                                    {form.name && form.lastName ? `${form.name} ${form.lastName}` : ''}
                                </div>
                                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Firma del Adoptante</p>
                                {form.dni && <p className="text-xs text-stone-500 mt-1">DNI: {form.dni}</p>}
                            </div>
                            <div className="text-center flex-1">
                                <div className="border-b-2 border-stone-400 h-12 mb-2 flex items-end justify-center pb-1 text-stone-500 italic text-sm">
                                    {animal?.rescuerName || ''}
                                </div>
                                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Firma del Rescatista</p>
                            </div>
                        </section>

                        {/* ── Submit ── */}
                        <div className="mt-10 pt-6 border-t border-stone-100 print:hidden">
                            <p className="text-xs text-stone-500 text-center mb-4">
                                Al hacer clic en &quot;Firmar&quot;, declaro haber leído y aceptado todas las cláusulas del presente contrato.
                            </p>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full py-3.5 bg-stone-800 text-white font-semibold rounded-xl hover:bg-stone-900 disabled:opacity-50 transition-all shadow-sm text-base active:scale-[0.98]"
                                style={{ fontFamily: 'system-ui, sans-serif' }}
                            >
                                {submitting ? 'Enviando...' : '✍️ Firmar y Enviar Contrato'}
                            </button>
                        </div>
                    </div>

                    {/* ── Footer ── */}
                    <div className="bg-stone-50 border-t border-stone-100 px-8 py-3 text-center print:hidden">
                        <p className="text-xs text-stone-500" style={{ fontFamily: 'system-ui, sans-serif' }}>
                            Contrato generado por BuenAdoptante
                        </p>
                    </div>
                </div>
            </form>
        </div>
    );
}
