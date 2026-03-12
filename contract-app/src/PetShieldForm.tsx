import { useState, useEffect, useRef, useCallback } from 'react'
import './petshield.css'

// ══════════════════════════════════════════════
// TYPES — JSON Schema
// ══════════════════════════════════════════════

interface ConsentStep {
    id: string; type: 'consent'; title: string; body: string;
    legalRef?: string; linkUrl?: string; linkLabel?: string;
}
interface TextFieldsStep {
    id: string; type: 'text-fields'; title: string;
    fields: Array<{ name: string; label: string; placeholder?: string; required?: boolean; validation?: 'email' | 'phone-ar' }>;
}
interface GeolocationStep {
    id: string; type: 'geolocation'; question: string;
    yesLabel?: string; noLabel?: string;
}
interface CameraUploadStep {
    id: string; type: 'camera-upload'; title: string; instructions?: string;
}
interface IconCardsStep {
    id: string; type: 'icon-cards'; title: string;
    options: Array<{ value: string; label: string; icon: string }>;
    warning?: { triggerValue: string; message: string };
}
interface SegmentedCardsStep {
    id: string; type: 'segmented-cards'; title: string;
    options: Array<{ value: string; label: string }>;
}
interface ToggleStep {
    id: string; type: 'toggle'; label: string; description?: string;
}
interface ChecklistStep {
    id: string; type: 'checklist'; title: string;
    options: Array<{ value: string; label: string; icon: string }>;
}

type FormStep = ConsentStep | TextFieldsStep | GeolocationStep | CameraUploadStep
    | IconCardsStep | SegmentedCardsStep | ToggleStep | ChecklistStep;

// ══════════════════════════════════════════════
// DEFAULT SCHEMA
// ══════════════════════════════════════════════

const DEFAULT_SCHEMA: FormStep[] = [
    {
        id: 'legal', type: 'consent', title: 'Protección de datos',
        body: 'Al continuar, aceptás que tus datos personales serán almacenados de forma segura con fines de registro y verificación, en cumplimiento de la Ley 25.326 de Protección de Datos Personales.',
        legalRef: 'Ley 25.326', linkLabel: 'Ver Términos y Condiciones',
    },
    {
        id: 'identity', type: 'text-fields', title: '¿Quién sos?',
        fields: [
            { name: 'name', label: 'Nombre completo', placeholder: 'Juan García', required: true },
            { name: 'email', label: 'Email', placeholder: 'juan@ejemplo.com', required: true, validation: 'email' },
            { name: 'phone', label: 'Teléfono', placeholder: '+54 11 1234-5678', validation: 'phone-ar' },
            { name: 'address', label: 'Dirección', placeholder: 'Av. Corrientes 1234, CABA', required: true },
        ],
    },
    {
        id: 'geo', type: 'geolocation',
        question: '¿Estás actualmente en tu domicilio?',
        yesLabel: 'Sí, estoy en mi casa', noLabel: 'No',
    },
    {
        id: 'selfie', type: 'camera-upload',
        title: 'Verificación de identidad',
        instructions: 'Tomá una selfie o subí una foto tuya para verificar tu identidad.',
    },
    {
        id: 'species', type: 'icon-cards', title: '¿Qué animal buscás?',
        options: [
            { value: 'dog', label: 'Perro', icon: 'dog' },
            { value: 'cat', label: 'Gato', icon: 'cat' },
            { value: 'both', label: 'Ambos', icon: 'both' },
            { value: 'other', label: 'Otro', icon: 'other' },
        ],
    },
    {
        id: 'lifeStage', type: 'segmented-cards', title: '¿Qué edad preferís?',
        options: [
            { value: 'puppy', label: 'Cachorro' },
            { value: 'young', label: 'Joven' },
            { value: 'senior', label: 'Senior' },
            { value: 'none', label: 'Sin preferencia' },
        ],
    },
    {
        id: 'specialNeeds', type: 'toggle',
        label: 'Abierto a necesidades especiales',
        description: 'Ej: gatos con ERC, animales con discapacidad o cuidado crónico.',
    },
    {
        id: 'intent', type: 'icon-cards', title: '¿Es para vos o es un regalo?',
        options: [
            { value: 'self', label: 'Para mí', icon: 'self' },
            { value: 'gift', label: 'Es un regalo', icon: 'gift' },
        ],
        warning: {
            triggerValue: 'gift',
            message: 'Nota: Los datos del cuidador principal siguen siendo necesarios para el registro legal (Ley 25.326).',
        },
    },
    {
        id: 'household', type: 'checklist', title: 'Contanos sobre tu hogar',
        options: [
            { value: 'children', label: 'Niños en el hogar', icon: 'children' },
            { value: 'pets', label: 'Mascotas existentes', icon: 'pets' },
            { value: 'outdoor', label: 'Espacio exterior seguro', icon: 'outdoor' },
            { value: 'presence', label: 'Presencia frecuente', icon: 'presence' },
        ],
    },
]

// ══════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════

const ICONS: Record<string, React.ReactNode> = {
    dog: <svg viewBox="0 0 64 64" fill="none"><path d="M32 12c-6 0-10 4-14 10-3 4-6 6-8 6-1 0-2 1-2 3 0 3 2 5 5 5h1c2 6 7 12 18 12s16-6 18-12h1c3 0 5-2 5-5 0-2-1-3-2-3-2 0-5-2-8-6C42 16 38 12 32 12z" fill="#818cf8"/><circle cx="24" cy="30" r="3" fill="#0f172a"/><circle cx="40" cy="30" r="3" fill="#0f172a"/><ellipse cx="32" cy="36" rx="4" ry="2.5" fill="#0f172a"/></svg>,
    cat: <svg viewBox="0 0 64 64" fill="none"><path d="M12 16l6 14h28l6-14-10 8H22L12 16z" fill="#a5b4fc"/><ellipse cx="32" cy="38" rx="16" ry="14" fill="#818cf8"/><circle cx="25" cy="34" r="2.5" fill="#0f172a"/><circle cx="39" cy="34" r="2.5" fill="#0f172a"/><path d="M29 40q3 2 6 0" stroke="#0f172a" strokeWidth="2" strokeLinecap="round"/><line x1="18" y1="36" x2="10" y2="34" stroke="#818cf8" strokeWidth="1.5"/><line x1="18" y1="39" x2="10" y2="40" stroke="#818cf8" strokeWidth="1.5"/><line x1="46" y1="36" x2="54" y2="34" stroke="#818cf8" strokeWidth="1.5"/><line x1="46" y1="39" x2="54" y2="40" stroke="#818cf8" strokeWidth="1.5"/></svg>,
    both: <svg viewBox="0 0 64 64" fill="none"><circle cx="22" cy="32" r="14" fill="#818cf8" opacity="0.7"/><circle cx="42" cy="32" r="14" fill="#a5b4fc" opacity="0.7"/><path d="M32 22a14 14 0 010 20 14 14 0 010-20z" fill="#6366f1" opacity="0.5"/><text x="15" y="36" fontSize="14" fill="#0f172a">🐶</text><text x="38" y="36" fontSize="14" fill="#0f172a">🐱</text></svg>,
    other: <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="18" fill="#818cf8" opacity="0.5"/><text x="22" y="40" fontSize="22" fill="#0f172a">🐾</text></svg>,
    self: <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="20" r="10" fill="#818cf8"/><path d="M16 52c0-10 7-18 16-18s16 8 16 18" fill="#a5b4fc" opacity="0.6"/><circle cx="32" cy="20" r="6" fill="#0f172a" opacity="0.2"/></svg>,
    gift: <svg viewBox="0 0 64 64" fill="none"><rect x="14" y="28" width="36" height="24" rx="4" fill="#818cf8"/><rect x="14" y="24" width="36" height="8" rx="3" fill="#a5b4fc"/><rect x="29" y="24" width="6" height="28" fill="#6366f1" opacity="0.5"/><path d="M32 24c-4-8-12-8-12-2s8 2 12 2z" fill="#a5b4fc"/><path d="M32 24c4-8 12-8 12-2s-8 2-12 2z" fill="#c7d2fe"/></svg>,
    children: <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="14" r="6" fill="#818cf8"/><path d="M14 40c0-7 5-14 10-14s10 7 10 14" fill="#818cf8" opacity="0.5"/><circle cx="36" cy="18" r="4" fill="#a5b4fc"/><path d="M30 40c0-5 3-10 6-10s6 5 6 10" fill="#a5b4fc" opacity="0.5"/></svg>,
    pets: <svg viewBox="0 0 48 48" fill="none"><ellipse cx="14" cy="16" rx="4" ry="5" fill="#818cf8"/><ellipse cx="26" cy="14" rx="4" ry="5" fill="#818cf8"/><ellipse cx="34" cy="20" rx="4" ry="5" fill="#818cf8"/><ellipse cx="8" cy="22" rx="4" ry="5" fill="#818cf8"/><ellipse cx="20" cy="30" rx="9" ry="8" fill="#a5b4fc"/></svg>,
    outdoor: <svg viewBox="0 0 48 48" fill="none"><rect x="6" y="22" width="36" height="18" rx="3" fill="#818cf8" opacity="0.3"/><path d="M6 22l18-14 18 14" fill="#818cf8"/><rect x="18" y="28" width="8" height="12" rx="1" fill="#a5b4fc"/><circle cx="38" cy="12" r="5" fill="#fbbf24" opacity="0.6"/><path d="M4 42h40" stroke="#a5b4fc" strokeWidth="2" opacity="0.3"/></svg>,
    presence: <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" fill="#818cf8" opacity="0.2"/><circle cx="24" cy="18" r="6" fill="#818cf8"/><path d="M14 38c0-7 5-12 10-12s10 5 10 12" fill="#818cf8" opacity="0.6"/><path d="M20 42v-4l4-3 4 3v4" fill="#a5b4fc" opacity="0.5"/></svg>,
}

// ══════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════

const VALIDATORS: Record<string, (v: string) => boolean> = {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'phone-ar': (v) => /^[\d+\s()-]{7,}$/.test(v),
}

// ══════════════════════════════════════════════
// STORAGE KEY
// ══════════════════════════════════════════════
const STORAGE_KEY = 'petshield_draft'

const API_URL = import.meta.env.VITE_API_URL || ''

// ══════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════

export default function PetShieldForm({ userId }: { userId: string | null }) {
    const schema = DEFAULT_SCHEMA
    const totalSteps = schema.length

    // ── State ──
    const [step, setStep] = useState(0)
    const [answers, setAnswers] = useState<Record<string, any>>({})
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [toast, setToast] = useState<{ message: string; id?: string } | null>(null)
    const [submitted, setSubmitted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [animationKey, setAnimationKey] = useState(0)

    // Camera
    const [hasCamera, setHasCamera] = useState<boolean | null>(null)
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = useState(false)

    // ── Hydrate from localStorage ──
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY)
            if (saved) {
                const parsed = JSON.parse(saved)
                if (parsed.answers) setAnswers(parsed.answers)
                if (typeof parsed.step === 'number') setStep(parsed.step)
            }
        } catch { /* ignore */ }
    }, [])

    // ── Persist to localStorage ──
    const persist = useCallback((currentStep: number, currentAnswers: Record<string, any>) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, answers: currentAnswers }))
        } catch { /* ignore */ }
    }, [])

    // ── Toast auto-dismiss ──
    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 6000)
        return () => clearTimeout(t)
    }, [toast])

    // ── Detect camera (once) ──
    useEffect(() => {
        if (hasCamera !== null) return
        navigator.mediaDevices?.enumerateDevices()
            .then(devices => setHasCamera(devices.some(d => d.kind === 'videoinput')))
            .catch(() => setHasCamera(false))
    }, [hasCamera])

    // ── Stop camera on step change ──
    useEffect(() => {
        if (schema[step]?.type !== 'camera-upload' && cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop())
            setCameraStream(null)
        }
    }, [step, cameraStream, schema])

    // ── Current step ──
    const currentStep = schema[step]
    const isLastStep = step === totalSteps - 1
    const progress = ((step + 1) / totalSteps) * 100

    // ── Answer helpers ──
    function setAnswer(key: string, value: any) {
        setAnswers(prev => ({ ...prev, [key]: value }))
        // Clear error
        if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
    }

    // ── Validation for current step ──
    function validateCurrentStep(): boolean {
        if (!currentStep) return false
        const newErrors: Record<string, string> = {}

        if (currentStep.type === 'consent') {
            if (!answers[currentStep.id]) {
                newErrors[currentStep.id] = 'Debés aceptar para continuar'
            }
        }

        if (currentStep.type === 'text-fields') {
            for (const field of currentStep.fields) {
                const val = (answers[field.name] || '').trim()
                if (field.required && !val) {
                    newErrors[field.name] = 'Campo obligatorio'
                } else if (val && field.validation && VALIDATORS[field.validation] && !VALIDATORS[field.validation](val)) {
                    newErrors[field.name] = field.validation === 'email' ? 'Email inválido' : 'Formato inválido'
                }
            }
        }

        if (currentStep.type === 'icon-cards') {
            if (!answers[currentStep.id]) {
                newErrors[currentStep.id] = 'Seleccioná una opción'
            }
        }

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    // ── Can advance ──
    function canAdvance(): boolean {
        if (!currentStep) return false
        switch (currentStep.type) {
            case 'consent': return !!answers[currentStep.id]
            case 'text-fields':
                return currentStep.fields.filter(f => f.required).every(f => (answers[f.name] || '').trim())
            case 'icon-cards': return !!answers[currentStep.id]
            case 'geolocation': return answers[currentStep.id] !== undefined
            case 'camera-upload': return true // optional
            case 'segmented-cards': return true // optional, has default
            case 'toggle': return true // optional
            case 'checklist': return true // optional
            default: return true
        }
    }

    // ── Navigation ──
    function goNext() {
        if (!validateCurrentStep()) return
        const nextStep = step + 1
        const nextAnswers = { ...answers }
        setAnimationKey(k => k + 1)

        if (nextStep >= totalSteps) {
            handleSubmit(nextAnswers)
        } else {
            setStep(nextStep)
            persist(nextStep, nextAnswers)
        }
    }

    function goBack() {
        if (step > 0) {
            setAnimationKey(k => k + 1)
            setStep(step - 1)
        }
    }

    // ── Submit ──
    async function handleSubmit(finalAnswers: Record<string, any>) {
        if (!userId) {
            setToast({ message: 'Error: enlace inválido — falta ID de usuario', id: 'ERR-FORM-001' })
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch(`${API_URL}/api/form/${encodeURIComponent(userId)}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalAnswers),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Error desconocido' })) as { error?: string }
                const errIdMatch = data.error?.match(/Error ID:\s*([a-zA-Z0-9-]+)/)
                setToast({ message: data.error || 'Error al enviar', id: errIdMatch?.[1] })
                return
            }
            // Success
            localStorage.removeItem(STORAGE_KEY)
            setSubmitted(true)
        } catch {
            setToast({ message: 'Error de red. Verificá tu conexión e intentá de nuevo.', id: 'ERR-NET-001' })
        } finally {
            setSubmitting(false)
        }
    }

    // ── Keyboard navigation ──
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (submitted || submitting) return
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canAdvance()) goNext()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    })

    // ── Geolocation handler ──
    function handleGeo(accept: boolean) {
        setAnswer(currentStep!.id, accept ? 'yes' : 'no')
        if (accept) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setAnswer('latitude', String(pos.coords.latitude))
                    setAnswer('longitude', String(pos.coords.longitude))
                },
                () => {
                    setToast({ message: 'No se pudo obtener la ubicación. Podés continuar sin ella.', id: 'ERR-GEO-102' })
                },
                { enableHighAccuracy: true, timeout: 10000 }
            )
        }
    }

    // ── Camera handlers ──
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
            setCameraStream(stream)
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                videoRef.current.play()
            }
        } catch {
            setToast({ message: 'No se pudo acceder a la cámara.', id: 'ERR-CAM-201' })
            setHasCamera(false)
        }
    }

    function capturePhoto() {
        if (!videoRef.current) return
        const canvas = document.createElement('canvas')
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
        setAnswer('selfie', dataUrl)
        cameraStream?.getTracks().forEach(t => t.stop())
        setCameraStream(null)
    }

    function handleFileSelect(file: File | null) {
        if (!file) return
        if (!file.type.startsWith('image/')) {
            setToast({ message: 'Solo se permiten imágenes.', id: 'ERR-FILE-301' })
            return
        }
        const reader = new FileReader()
        reader.onload = () => setAnswer('selfie', reader.result as string)
        reader.readAsDataURL(file)
    }

    // ── Completion screen ──
    if (submitted) {
        return (
            <div className="ps-form">
                <div className="ps-step-container">
                    <div className="ps-complete">
                        <div className="ps-complete__icon">🎉</div>
                        <h2 className="ps-complete__title">¡Listo!</h2>
                        <p className="ps-complete__desc">
                            Tu solicitud fue enviada exitosamente. El rescatista recibirá tu información y se pondrá en contacto pronto.
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    // ── No userId ──
    if (!userId) {
        return (
            <div className="ps-form">
                <div className="ps-step-container">
                    <div className="ps-complete">
                        <div className="ps-complete__icon">🔗</div>
                        <h2 className="ps-complete__title">Enlace inválido</h2>
                        <p className="ps-complete__desc">
                            Este formulario necesita un enlace válido. Pedí uno nuevo al rescatista.
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    // ══════════════════════════════════════════════
    // RENDERERS
    // ══════════════════════════════════════════════

    function renderStep() {
        if (!currentStep) return null
        const key = `step-${step}-${animationKey}`

        switch (currentStep.type) {
            case 'consent': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    <div className="ps-consent-body">
                        <p>{currentStep.body}</p>
                        {currentStep.linkLabel && (
                            <p style={{ marginTop: 'var(--ps-2)' }}>
                                <a href="/terms" target="_blank" rel="noopener noreferrer">
                                    {currentStep.linkLabel} →
                                </a>
                            </p>
                        )}
                    </div>
                    <div
                        className={`ps-toggle-row ${answers[currentStep.id] ? 'ps-toggle-row--active' : ''}`}
                        onClick={() => setAnswer(currentStep.id, !answers[currentStep.id])}
                        role="checkbox"
                        aria-checked={!!answers[currentStep.id]}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setAnswer(currentStep.id, !answers[currentStep.id]) } }}
                    >
                        <div>
                            <div className="ps-toggle__label">Acepto los Términos y Condiciones</div>
                            {currentStep.legalRef && (
                                <div className="ps-toggle__desc">Conforme a {currentStep.legalRef}</div>
                            )}
                        </div>
                        <div className={`ps-toggle__track ${answers[currentStep.id] ? 'ps-toggle__track--on' : ''}`}>
                            <div className="ps-toggle__thumb" />
                        </div>
                    </div>
                    {errors[currentStep.id] && <div className="ps-field__error">{errors[currentStep.id]}</div>}
                </div>
            )

            case 'text-fields': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    <div className="ps-input-group">
                        {currentStep.fields.map((field, i) => (
                            <div className="ps-field" key={field.name}>
                                <label className="ps-field__label">
                                    {field.label} {field.required && <span style={{ color: 'var(--ps-accent)' }}>*</span>}
                                </label>
                                <input
                                    className={`ps-input ${errors[field.name] ? 'ps-input--error' : ''}`}
                                    type={field.validation === 'email' ? 'email' : field.validation === 'phone-ar' ? 'tel' : 'text'}
                                    placeholder={field.placeholder || ''}
                                    value={answers[field.name] || ''}
                                    onChange={(e) => setAnswer(field.name, e.target.value)}
                                    autoFocus={i === 0}
                                />
                                {errors[field.name] && <div className="ps-field__error">{errors[field.name]}</div>}
                            </div>
                        ))}
                    </div>
                    <div className="ps-kbd-hint">
                        Presioná <kbd>Enter</kbd> para continuar
                    </div>
                </div>
            )

            case 'geolocation': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.question}</h1>
                    <p className="ps-subtitle">Esto nos ayuda a verificar tu ubicación. Es opcional.</p>
                    <div className="ps-card-grid ps-card-grid--2">
                        {[
                            { value: 'yes', label: currentStep.yesLabel || 'Sí', icon: '📍' },
                            { value: 'no', label: currentStep.noLabel || 'No', icon: '🚶' },
                        ].map(opt => (
                            <button
                                key={opt.value}
                                className={`ps-card ${answers[currentStep.id] === opt.value ? 'ps-card--selected' : ''}`}
                                onClick={() => handleGeo(opt.value === 'yes')}
                                tabIndex={0}
                            >
                                <span style={{ fontSize: 32 }}>{opt.icon}</span>
                                <span className="ps-card__label">{opt.label}</span>
                                <span className="ps-card__check">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </span>
                            </button>
                        ))}
                    </div>
                    {answers.latitude && (
                        <div className="ps-geo-status">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#34d399"/><path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            Ubicación obtenida
                        </div>
                    )}
                </div>
            )

            case 'camera-upload': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    {currentStep.instructions && <p className="ps-subtitle">{currentStep.instructions}</p>}

                    {answers.selfie ? (
                        <div style={{ textAlign: 'center' }}>
                            <img src={answers.selfie} alt="Selfie" className="ps-upload-zone__preview" />
                            <button
                                className="ps-btn ps-btn--ghost"
                                onClick={() => setAnswer('selfie', null)}
                                style={{ marginTop: 'var(--ps-2)' }}
                            >
                                Cambiar foto
                            </button>
                        </div>
                    ) : cameraStream ? (
                        <div style={{ textAlign: 'center' }}>
                            <video ref={videoRef} className="ps-camera-preview" autoPlay playsInline muted />
                            <button className="ps-btn ps-btn--primary ps-camera-btn" onClick={capturePhoto}>
                                📸 Capturar
                            </button>
                        </div>
                    ) : (
                        <>
                            {hasCamera && (
                                <button className="ps-btn ps-btn--primary" onClick={startCamera} style={{ width: '100%', marginBottom: 'var(--ps-2)', justifyContent: 'center' }}>
                                    📸 Tomar Selfie
                                </button>
                            )}
                            <div
                                className={`ps-upload-zone ${dragOver ? 'ps-upload-zone--dragover' : ''}`}
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0]) }}
                            >
                                <div style={{ fontSize: 40, marginBottom: 'var(--ps-1)' }}>📁</div>
                                <p style={{ color: 'var(--ps-text-secondary)', fontSize: 14, fontWeight: 600 }}>
                                    {hasCamera ? 'O arrastrá una foto acá' : 'Arrastrá una foto o hacé clic para seleccionar'}
                                </p>
                                <p style={{ color: 'var(--ps-text-muted)', fontSize: 12, marginTop: 4 }}>
                                    JPG, PNG — máx 5MB
                                </p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                            />
                        </>
                    )}
                    <p className="ps-kbd-hint" style={{ marginTop: 'var(--ps-3)' }}>
                        Este paso es opcional — podés continuar sin foto
                    </p>
                </div>
            )

            case 'icon-cards': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    <div className={`ps-card-grid ${currentStep.options.length <= 2 ? 'ps-card-grid--2' : 'ps-card-grid--4'}`}>
                        {currentStep.options.map(opt => (
                            <button
                                key={opt.value}
                                className={`ps-card ${answers[currentStep.id] === opt.value ? 'ps-card--selected' : ''}`}
                                onClick={() => setAnswer(currentStep.id, opt.value)}
                                tabIndex={0}
                            >
                                <div className="ps-card__icon">
                                    {ICONS[opt.icon] || <span style={{ fontSize: 32 }}>🐾</span>}
                                </div>
                                <span className="ps-card__label">{opt.label}</span>
                                <span className="ps-card__check">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </span>
                            </button>
                        ))}
                    </div>
                    {currentStep.warning && answers[currentStep.id] === currentStep.warning.triggerValue && (
                        <div className="ps-warning-banner">
                            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                            <span className="ps-warning-banner__text">{currentStep.warning.message}</span>
                        </div>
                    )}
                    {errors[currentStep.id] && <div className="ps-field__error">{errors[currentStep.id]}</div>}
                    <div className="ps-kbd-hint">
                        Usá <kbd>←</kbd> <kbd>→</kbd> para navegar, <kbd>Enter</kbd> para confirmar
                    </div>
                </div>
            )

            case 'segmented-cards': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    <div className="ps-segmented">
                        {currentStep.options.map(opt => (
                            <button
                                key={opt.value}
                                className={`ps-segmented__item ${answers[currentStep.id] === opt.value ? 'ps-segmented__item--selected' : ''}`}
                                onClick={() => setAnswer(currentStep.id, opt.value)}
                                tabIndex={0}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            )

            case 'toggle': return (
                <div className="ps-step" key={key}>
                    <div
                        className={`ps-toggle-row ${answers[currentStep.id] ? 'ps-toggle-row--active' : ''}`}
                        onClick={() => setAnswer(currentStep.id, !answers[currentStep.id])}
                        role="switch"
                        aria-checked={!!answers[currentStep.id]}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setAnswer(currentStep.id, !answers[currentStep.id]) } }}
                    >
                        <div>
                            <div className="ps-toggle__label">{currentStep.label}</div>
                            {currentStep.description && <div className="ps-toggle__desc">{currentStep.description}</div>}
                        </div>
                        <div className={`ps-toggle__track ${answers[currentStep.id] ? 'ps-toggle__track--on' : ''}`}>
                            <div className="ps-toggle__thumb" />
                        </div>
                    </div>
                </div>
            )

            case 'checklist': return (
                <div className="ps-step" key={key}>
                    <h1 className="ps-title">{currentStep.title}</h1>
                    <div className="ps-checklist">
                        {currentStep.options.map(opt => {
                            const sel = (answers[currentStep.id] || []) as string[]
                            const isSelected = sel.includes(opt.value)
                            return (
                                <button
                                    key={opt.value}
                                    className={`ps-check-item ${isSelected ? 'ps-check-item--selected' : ''}`}
                                    onClick={() => {
                                        const updated = isSelected ? sel.filter(v => v !== opt.value) : [...sel, opt.value]
                                        setAnswer(currentStep.id, updated)
                                    }}
                                    tabIndex={0}
                                >
                                    <div className="ps-check-item__box">
                                        {isSelected && (
                                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        )}
                                    </div>
                                    <div className="ps-check-item__icon">
                                        {ICONS[opt.icon] || <span>🐾</span>}
                                    </div>
                                    <span className="ps-check-item__label">{opt.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )

            default: return null
        }
    }

    return (
        <div className="ps-form">
            {/* Progress */}
            <div className="ps-progress-track">
                <div className="ps-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {/* Toast */}
            {toast && (
                <div className="ps-toast ps-toast--error">
                    <span>⚠️ {toast.message}</span>
                    {toast.id && <span className="ps-toast__id">{toast.id}</span>}
                    <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 0 0 8px', fontSize: 16 }}>×</button>
                </div>
            )}

            {/* Step Content */}
            <div className="ps-step-container">
                <div className="ps-step-counter" style={{ marginBottom: 'var(--ps-3)' }}>
                    Paso {step + 1} de {totalSteps}
                </div>
                {renderStep()}
            </div>

            {/* Navigation */}
            <div className="ps-nav">
                <button
                    className="ps-btn ps-btn--ghost"
                    onClick={goBack}
                    disabled={step === 0}
                >
                    ← Atrás
                </button>
                <button
                    className="ps-btn ps-btn--primary"
                    onClick={goNext}
                    disabled={!canAdvance() || submitting}
                >
                    {submitting ? '⏳ Enviando...' : isLastStep ? '✅ Enviar' : 'Continuar →'}
                </button>
            </div>
        </div>
    )
}
