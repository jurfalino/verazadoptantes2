import { useState, useEffect, useRef } from 'react'
import { generateContractPdf, blobToBase64 } from './contractPdf'

const API_URL = import.meta.env.VITE_API_URL || ''

/** Extract Error ID from API error messages like "Submission failed (Error ID: abc123)" */
function extractErrorId(msg?: string | null): string | null {
    if (!msg) return null
    const match = msg.match(/Error ID:\s*([a-zA-Z0-9-]+)/)
    return match ? match[1] : null
}

interface AnimalImage {
    id: string
    url: string
    caption: string | null
}

interface AnimalData {
    id: string
    animalName: string
    species: string | null
    details: string | null
    comments: string | null
    age: string | null
    sex: string | null
    color: string | null
    microchip: string | null
    rescuerName: string | null
    images: AnimalImage[]
}

/**
 * Two entry shapes:
 *   • Legacy open path — `<ContractPage animalId={uuid} />`. Anyone with the
 *     link can sign; submitting creates a new adopter row (source='contract').
 *   • Locked path (v2.14.10-21 / Phase 5) — `<ContractPage token={uuid} />`.
 *     Token resolves to a specific (animalId, adopterId). Form is pre-filled
 *     with the adopter's prior info and a "Para {name}" badge appears at the
 *     top. Submitting links the existing adopter instead of creating one.
 */
export default function ContractPage({ animalId, token }: { animalId?: string; token?: string }) {
    const contractRef = useRef<HTMLDivElement>(null)
    const [animal, setAnimal] = useState<AnimalData | null>(null)
    const [resolvedAnimalId, setResolvedAnimalId] = useState<string | null>(animalId || null)
    const [intendedAdopterName, setIntendedAdopterName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [errorId, setErrorId] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [contractSaved, setContractSaved] = useState<boolean | null>(null)
    const [contractPdfData, setContractPdfData] = useState<string | null>(null)
    const [retrying, setRetrying] = useState(false)
    const [copied, setCopied] = useState(false)

    const [form, setForm] = useState({
        name: '',
        lastName: '',
        dni: '',
        email: '',
        phone: '',
        address: '',
        socialNetworks: '',
        locality: '',
    })

    useEffect(() => {
        async function load() {
            try {
                const url = token
                    ? `${API_URL}/api/contract/by-token/${token}`
                    : `${API_URL}/api/contract/${animalId}`
                const res = await fetch(url)
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    const code = (data as { code?: string }).code
                    let errMsg: string
                    if (res.status === 404) errMsg = 'Contrato no encontrado'
                    else if (res.status === 410 && code === 'used') errMsg = 'Este link ya fue usado'
                    else if (res.status === 410 && code === 'expired') errMsg = 'Este link expiró'
                    else if (res.status === 410 && code === 'already_adopted') errMsg = 'Este animal ya fue adoptado'
                    else errMsg = (data as { error?: string }).error || 'Error al cargar'
                    const id = extractErrorId((data as { error?: string }).error)
                    console.error(`[CONTRACT] Load failed (${res.status}):`, errMsg)
                    setError(errMsg)
                    if (id) setErrorId(id)
                    return
                }
                if (token) {
                    const data = await res.json() as { animal: AnimalData; adopterName: string; prefill: { name: string; lastName: string; email: string; phone: string; address: string; dni: string } }
                    setAnimal(data.animal)
                    setResolvedAnimalId(data.animal.id)
                    setIntendedAdopterName(data.adopterName)
                    setForm(prev => ({ ...prev, ...data.prefill }))
                } else {
                    setAnimal(await res.json())
                }
            } catch (err) {
                console.error('[CONTRACT] Network error loading contract:', err)
                setError('Error de red al cargar los datos del contrato')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [animalId, token])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitting) return
        setSubmitting(true)

        try {
            // 1. Generate PDF of the signed contract (or reuse on retry)
            let contractDataUrl = contractPdfData
            if (!contractDataUrl) {
                try {
                    const pdfBlob = generateContractPdf(animal!, form)
                    if (pdfBlob) {
                        contractDataUrl = await blobToBase64(pdfBlob)
                        setContractPdfData(contractDataUrl)
                        console.log(`[CONTRACT] PDF generated: ${Math.round(pdfBlob.size / 1024)}KB`)
                    } else {
                        console.warn('[CONTRACT] PDF generation returned null')
                    }
                } catch (pdfErr) {
                    console.error('[CONTRACT] PDF generation failed:', pdfErr)
                }
            } else {
                console.log('[CONTRACT] Reusing existing PDF for retry')
            }

            // 2. Submit the form data + PDF. When in token mode, pass the token
            // so the backend links the existing adopter (no new row).
            const targetAnimalId = resolvedAnimalId || animalId
            const res = await fetch(`${API_URL}/api/contract/${targetAnimalId}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, screenshot: contractDataUrl, token: token || undefined }),
            })

            if (res.ok) {
                setContractSaved(true)
                setSubmitted(true)
            } else {
                const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
                const id = extractErrorId(data.error)
                console.error(`[CONTRACT] Submit failed (${res.status}):`, data.error)
                setError(data.error || 'Error al enviar el contrato')
                if (id) setErrorId(id)
            }
        } catch (err) {
            console.error('[CONTRACT] Network error:', err)
            setError('Error de red al enviar el contrato')
        } finally {
            setSubmitting(false)
        }
    }

    const retryContractUpload = async () => {
        if (!contractPdfData) return
        setRetrying(true)
        try {
            const targetAnimalId = resolvedAnimalId || animalId
            const res = await fetch(`${API_URL}/api/contract/${targetAnimalId}/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ screenshot: contractPdfData }),
            })
            if (res.ok) {
                setContractSaved(true)
                setError(null)
                setSubmitted(true)
                console.log('[CONTRACT] Retry upload succeeded')
            } else {
                const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
                console.error('[CONTRACT] Retry failed:', data.error)
            }
        } catch (err) {
            console.error('[CONTRACT] Retry network error:', err)
        } finally {
            setRetrying(false)
        }
    }

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
            className={`${width} border-0 border-b-2 border-stone-300 bg-transparent px-1 py-0.5 text-stone-900 font-medium placeholder-stone-300 focus:border-indigo-500 focus:bg-indigo-50/30 outline-none transition-all text-sm`}
        />
    )

    const staticBlank = (value: string | null | undefined, fallback = '—') => (
        <span className="border-b-2 border-stone-200 px-1 py-0.5 text-stone-900 font-medium inline-block min-w-[150px]">
            {value || fallback}
        </span>
    )

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center">
                <div className="text-stone-400 animate-pulse text-sm">Cargando contrato...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md space-y-4">
                    <div className="text-5xl">😿</div>
                    <h3 className="text-xl font-extrabold text-stone-900">
                        Algo salió mal / Something went wrong
                    </h3>
                    <p className="text-stone-500 text-sm">
                        {error}
                    </p>
                    {errorId && (
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(errorId)
                                setCopied(true)
                                setTimeout(() => setCopied(false), 2000)
                            }}
                            className="inline-flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors"
                        >
                            {copied ? '✓ Copiado' : '📋 Copiar'} Error ID: {errorId}
                        </button>
                    )}
                    <div className="pt-2 flex gap-2 justify-center">
                        <button
                            onClick={() => {
                                setError(null)
                                setErrorId(null)
                                // Re-submit the form (PDF data is still in state)
                                handleSubmit({ preventDefault: () => { } } as React.FormEvent)
                            }}
                            disabled={submitting}
                            className="px-6 py-2.5 bg-stone-800 text-white rounded-xl font-bold text-sm hover:bg-stone-900 disabled:opacity-50 transition-colors shadow-md"
                        >
                            {submitting ? '⏳ Enviando...' : '🔄 Reintentar / Try Again'}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl p-8 text-center border border-emerald-200 shadow-sm max-w-md">
                    <div className="text-5xl mb-4">🎉</div>
                    <h3 className="text-2xl font-bold text-stone-900 mb-2">¡Adopción Registrada!</h3>
                    <p className="text-stone-500 mb-4">
                        El contrato de adopción de <strong>{animal?.animalName}</strong> ha sido enviado exitosamente.
                        El rescatista se pondrá en contacto contigo.
                    </p>
                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-sm text-emerald-800">
                        <p className="font-bold mb-1">Próximos pasos:</p>
                        <ul className="text-left space-y-1">
                            <li>✅ Tus datos fueron registrados</li>
                            {contractSaved === true && <li>📄 Contrato firmado guardado</li>}
                            {contractSaved === false && (
                                <li className="text-amber-700">
                                    ⚠️ El contrato no pudo guardarse
                                    {contractPdfData && (
                                        <button
                                            onClick={retryContractUpload}
                                            disabled={retrying}
                                            className="ml-2 px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors"
                                        >
                                            {retrying ? '⏳ Reintentando...' : '🔄 Reintentar'}
                                        </button>
                                    )}
                                </li>
                            )}
                            <li>📞 El rescatista te contactará pronto</li>
                            <li>🏠 Coordinarán una visita o entrega</li>
                        </ul>
                    </div>
                </div>
            </div>
        )
    }

    const today = new Date()
    const day = today.getDate()
    const month = today.toLocaleDateString('es-AR', { month: 'long' })
    const year = today.getFullYear()
    const speciesEmoji = animal?.species === 'cat' ? '🐱' : animal?.species === 'dog' ? '🐶' : '🐾'
    const hasPhoto = animal?.images && animal.images.length > 0

    return (
        <div className="min-h-screen bg-stone-200 py-6 px-4 print:bg-white print:py-0">
            {/* Intended-adopter banner (token / locked-link path only). Tells the
                signer the link was prepared specifically for them, so they don't
                wonder whether they should sign on behalf of someone else. */}
            {intendedAdopterName && !submitted && (
                <div className="max-w-3xl mx-auto mb-4 rounded-xl bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-800 flex items-center gap-2 print:hidden">
                    <span className="text-base">✉️</span>
                    <span><span className="font-semibold">Para {intendedAdopterName}:</span> este link fue preparado especialmente para vos. Tus datos ya están cargados — revisalos antes de firmar.</span>
                </div>
            )}
            <form onSubmit={handleSubmit}>
                {/* ref wraps the entire contract for screenshot */}
                <div
                    ref={contractRef}
                    className="max-w-3xl mx-auto bg-white shadow-xl rounded-lg overflow-hidden print:shadow-none print:rounded-none"
                    style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                >
                    {/* Contract body */}
                    <div className="px-8 sm:px-12 py-10 text-sm text-stone-800 leading-relaxed space-y-6">

                        <h1 className="text-center text-base font-bold tracking-wide uppercase mb-6">
                            CONTRATO DE ADOPCIÓN RESPONSABLE DE ANIMAL DE COMPAÑÍA
                        </h1>

                        <p>
                            En la localidad de {blank('locality', 'Ciudad / Localidad', 'min-w-[180px]', true)}, a los <span className="font-medium">{day}</span> días del mes de <span className="font-medium">{month}</span> de {year}, se celebra el presente contrato entre:
                        </p>

                        {/* EL ADOPTANTE */}
                        <div className="border border-stone-200 rounded-lg p-5 bg-stone-50/50 space-y-3">
                            <h2 className="text-xs font-bold uppercase tracking-widest text-indigo-700 mb-2">El Adoptante:</h2>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Nombre y Apellido:</span>
                                {blank('name', 'Nombre', 'min-w-[140px]', true)}
                                {blank('lastName', 'Apellido', 'min-w-[140px]', true)}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Documento de Identidad / Personal ID:</span>
                                {blank('dni', 'N° de documento', 'min-w-[140px]', true)}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Domicilio Real:</span>
                                {blank('address', 'Calle, número, ciudad, país', 'min-w-[300px] flex-1', true)}
                            </p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Teléfono de contacto:</span>
                                {blank('phone', 'Código de país + número', 'min-w-[180px]', true, 'tel')}
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

                        {/* EL RESCATISTA */}
                        <div className="border border-stone-200 rounded-lg p-5 bg-stone-50/50 space-y-3">
                            <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">El Rescatista / Protectora:</h2>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold whitespace-nowrap">Nombre / Institución:</span>
                                {staticBlank(animal?.rescuerName)}
                            </p>
                        </div>

                        <hr className="border-stone-200" />

                        {/* 1. DATOS DEL ANIMAL — photo beside data */}
                        <section>
                            <h2 className="font-bold text-stone-900 mb-3">1. DATOS DEL ANIMAL</h2>
                            <div className="flex flex-col sm:flex-row gap-5 pl-4">
                                {/* Animal photo — contained, not cropped */}
                                {hasPhoto && (
                                    <div className="flex-shrink-0 self-start">
                                        <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-xl border-2 border-stone-200 bg-stone-50 overflow-hidden flex items-center justify-center">
                                            <img
                                                src={animal!.images[0].url}
                                                alt={animal?.animalName || 'Animal'}
                                                className="w-full h-full object-contain"
                                            />
                                        </div>
                                    </div>
                                )}
                                <div className="flex-1 space-y-2">
                                    <p><span className="font-semibold">Nombre:</span> {staticBlank(animal?.animalName)}</p>
                                    <p><span className="font-semibold">Especie:</span> {staticBlank(animal?.species ? `${speciesEmoji} ${animal.species}` : null)}</p>
                                    <p><span className="font-semibold">Edad aprox.:</span> {staticBlank(animal?.age)}</p>
                                    <p><span className="font-semibold">Sexo:</span> {staticBlank(animal?.sex ? (animal.sex === 'macho' ? '♂ Macho' : '♀ Hembra') : null)}</p>
                                    <p><span className="font-semibold">Color/Señas:</span> {staticBlank(animal?.color || animal?.details)}</p>
                                    <p><span className="font-semibold">N° de Microchip (si posee):</span> {staticBlank(animal?.microchip)}</p>
                                </div>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* 2. COMPROMISOS DEL ADOPTANTE */}
                        <section>
                            <h2 className="font-bold text-stone-900 mb-3">2. COMPROMISOS DEL ADOPTANTE</h2>
                            <p className="mb-3">El adoptante declara aceptar la tenencia del animal bajo las siguientes cláusulas obligatorias:</p>
                            <div className="space-y-3 pl-4">
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Bienestar y Trato:</p>
                                    <p>El animal será tratado como un miembro de la familia. Se prohíbe terminantemente mantenerlo encadenado, en balcones sin protección, en terrazas/patios sin refugio o deambulando solo por la vía pública.</p>
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Salud:</p>
                                    <p>El adoptante se compromete a brindar asistencia veterinaria inmediata ante enfermedades o accidentes, mantener el plan de vacunación anual y la desparasitación al día.</p>
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Esterilización:</p>
                                    <p>(Si no está castrado) El adoptante se obliga a castrar al animal al cumplir los 6 meses de edad, enviando el certificado correspondiente al rescatista. Se prohíbe su uso para cría o reproducción.</p>
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Seguridad (Gatos):</p>
                                    <p>En caso de felinos, el adoptante garantiza que la vivienda cuenta con mallas de protección en ventanas y balcones para evitar caídas (Síndrome del gato paracaidista) o escapes.</p>
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Prohibición de Uso Utilitario:</p>
                                    <p>El animal no podrá ser utilizado para fines de seguridad (guardia), control de plagas (caza de roedores), ni experimentos de ninguna índole.</p>
                                </div>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* 3. SEGUIMIENTO Y NO ABANDONO */}
                        <section>
                            <h2 className="font-bold text-stone-900 mb-3">3. SEGUIMIENTO Y NO ABANDONO</h2>
                            <div className="space-y-3 pl-4">
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Seguimiento:</p>
                                    <p>El adoptante acepta recibir visitas programadas y enviar fotos/videos periódicos del animal para constatar su estado de salud y adaptación.</p>
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800 text-xs uppercase tracking-wide mb-0.5">Prohibición de Cesión:</p>
                                    <p>Si por razones de fuerza mayor el adoptante no pudiera continuar con la tenencia, está estrictamente prohibido regalarlo, venderlo o abandonarlo. Deberá comunicarse inmediatamente con el rescatista para coordinar el retorno del animal o una nueva adopción supervisada.</p>
                                </div>
                            </div>
                        </section>

                        <hr className="border-stone-200" />

                        {/* 4. INCUMPLIMIENTO */}
                        <section>
                            <h2 className="font-bold text-stone-900 mb-3">4. INCUMPLIMIENTO Y PROTECCIÓN ANIMAL</h2>
                            <p className="pl-4 mb-3">El incumplimiento de cualquiera de las obligaciones pactadas en este documento facultará al rescatista a declarar la resolución del contrato y exigir la restitución inmediata del animal para garantizar su integridad física y emocional.</p>
                            <p className="pl-4">Esta acción se llevará a cabo sin perjuicio de las denuncias y acciones legales (civiles o penales) que correspondan bajo la legislación vigente en materia de protección y bienestar animal de la jurisdicción correspondiente, la cual sanciona el maltrato, la crueldad y el abandono de seres sintientes.</p>
                        </section>

                        <hr className="border-stone-200" />

                        {/* 5. CONSENTIMIENTO */}
                        <section>
                            <h2 className="font-bold text-stone-900 mb-3">5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO</h2>
                            <p className="pl-4">El Adoptante presta su consentimiento expreso para que los datos personales consignados en este contrato sean incorporados a los registros internos del Rescatista y a bases de datos compartidas entre organizaciones de protección animal debidamente acreditadas.</p>
                        </section>

                        <hr className="border-stone-300 border-t-2 my-8" />

                        {/* Signatures */}
                        <section className="flex flex-col sm:flex-row justify-between gap-8 mt-8">
                            <div className="text-center flex-1">
                                <div className="border-b-2 border-stone-400 h-12 mb-2 flex items-end justify-center pb-1 text-stone-400 italic text-sm">
                                    {form.name && form.lastName ? `${form.name} ${form.lastName}` : ''}
                                </div>
                                <p className="text-xs font-bold text-stone-500 uppercase tracking-wide">Firma del Adoptante</p>
                                {form.dni && <p className="text-xs text-stone-400 mt-1">Documento: {form.dni}</p>}
                            </div>
                            <div className="text-center flex-1">
                                <div className="border-b-2 border-stone-400 h-12 mb-2 flex items-end justify-center pb-1 text-stone-500 italic text-sm">
                                    {animal?.rescuerName || ''}
                                </div>
                                <p className="text-xs font-bold text-stone-500 uppercase tracking-wide">Firma del Rescatista</p>
                            </div>
                        </section>

                        {/* Submit */}
                        <div className="mt-10 pt-6 border-t border-stone-100 print:hidden">
                            <p className="text-xs text-stone-400 text-center mb-4">
                                Al hacer clic en &quot;Firmar&quot;, declaro haber leído y aceptado todas las cláusulas del presente contrato.
                            </p>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full py-3.5 bg-stone-800 text-white font-bold rounded-xl hover:bg-stone-900 disabled:opacity-50 transition-all shadow-sm text-base active:scale-[0.98] cursor-pointer"
                                style={{ fontFamily: 'system-ui, sans-serif' }}
                            >
                                {submitting ? '📄 Generando contrato y enviando...' : '✍️ Firmar y Enviar Contrato'}
                            </button>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="bg-stone-50 border-t border-stone-100 px-8 py-3 text-center print:hidden">
                        <p className="text-[11px] text-stone-400" style={{ fontFamily: 'system-ui, sans-serif' }}>
                            Contrato de adopción responsable
                        </p>
                    </div>
                </div>
            </form>
        </div>
    )
}
