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

interface PetCounterStep {
    id: string; type: 'pet-counter'; title: string; subtitle?: string;
    petTypes: Array<{ value: string; label: string; icon: string }>;
}

type FormStep = ConsentStep | TextFieldsStep | GeolocationStep | CameraUploadStep
    | IconCardsStep | SegmentedCardsStep | ToggleStep | ChecklistStep | PetCounterStep;

// ══════════════════════════════════════════════
// DEFAULT SCHEMA
// ══════════════════════════════════════════════

const DEFAULT_SCHEMA: FormStep[] = [
    {
        id: 'legal', type: 'consent', title: 'Solicitud de adopción',
        body: 'Completá este breve formulario para registrar tu interés en adoptar. Nos ayuda a encontrar el animal ideal según lo que buscás. El rescatista revisará tu solicitud para ponerse en contacto.',
        legalRef: 'Ley 25.326',
    },
    // Preferences & situation first (honesty-friendly order)
    {
        id: 'species', type: 'icon-cards', title: '¿Qué animal buscás?',
        options: [
            { value: 'dog', label: 'Perro', icon: 'dog' },
            { value: 'cat', label: 'Gato', icon: 'cat' },
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
        id: 'children', type: 'segmented-cards', title: '¿Hay niños en el hogar?',
        options: [
            { value: 'none', label: 'No' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3+', label: '3+' },
        ],
    },
    {
        id: 'existingPets', type: 'pet-counter', title: '¿Tenés mascotas actualmente?',
        subtitle: 'Tocá cada ícono para sumar una mascota de ese tipo',
        petTypes: [
            { value: 'dogs', label: 'Perros', icon: 'dog' },
            { value: 'cats', label: 'Gatos', icon: 'cat' },
            { value: 'birds', label: 'Pájaros', icon: 'bird' },
            { value: 'other', label: 'Otro', icon: 'other' },
        ],
    },
    {
        id: 'housingType', type: 'icon-cards', title: '¿Dónde vivís?',
        options: [
            { value: 'house', label: 'Casa', icon: 'outdoor' },
            { value: 'apartment', label: 'Departamento', icon: 'apartment' },
        ],
    },
    {
        id: 'hasOutdoor', type: 'icon-cards', title: '¿Tenés patio o jardín?',
        options: [
            { value: 'yes', label: 'Sí', icon: 'outdoor' },
            { value: 'no', label: 'No', icon: 'indoor' },
        ],
    },
    {
        id: 'isSafe', type: 'icon-cards', title: '¿El espacio está protegido?',
        options: [
            { value: 'yes', label: 'Sí, está cerrado', icon: 'outdoor' },
            { value: 'no', label: 'No está cerrado', icon: 'unfenced' },
            { value: 'na', label: 'No aplica', icon: 'other' },
        ],
    },
    {
        id: 'hoursAlone', type: 'segmented-cards', title: '¿Cuántas horas al día estaría solo el animal?',
        options: [
            { value: '0-2', label: '0–2' },
            { value: '3-5', label: '3–5' },
            { value: '6-8', label: '6–8' },
            { value: '8+', label: '8+' },
        ],
    },
    {
        id: 'petExperience', type: 'icon-cards', title: '¿Tuviste mascotas antes?',
        options: [
            { value: 'no', label: 'No, primera vez', icon: 'other' },
            { value: 'cat', label: 'Sí, gato', icon: 'cat' },
            { value: 'dog', label: 'Sí, perro', icon: 'dog' },
            { value: 'other', label: 'Sí, otro', icon: 'bird' },
        ],
    },
    {
        id: 'willingToSterilize', type: 'icon-cards', title: '¿Estás dispuesto/a a castrar o esterilizar?',
        options: [
            { value: 'yes', label: 'Sí', icon: 'self' },
            { value: 'no', label: 'No', icon: 'decline' },
        ],
    },
    {
        id: 'vetCommitment', type: 'toggle',
        label: 'Me comprometo a llevar al animal al veterinario',
        description: 'Vacunación, controles y atención cuando sea necesario',
    },
    {
        id: 'movingPlans', type: 'icon-cards', title: '¿Tenés pensado mudarte pronto?',
        options: [
            { value: 'no', label: 'No', icon: 'outdoor' },
            { value: 'maybe', label: 'Posiblemente', icon: 'maybe' },
            { value: 'yes', label: 'Sí', icon: 'gift' },
        ],
    },
    {
        id: 'vacationPlan', type: 'icon-cards', title: '¿Qué harías con el animal en vacaciones?',
        options: [
            { value: 'take', label: 'Lo llevo conmigo', icon: 'self' },
            { value: 'family', label: 'Lo cuida familia', icon: 'children' },
            { value: 'sitter', label: 'Cuidador / guardería', icon: 'sitter' },
            { value: 'unsure', label: 'No lo sé aún', icon: 'other' },
        ],
    },
    // Identity & verification last
    {
        id: 'identity-name', type: 'text-fields', title: '¿Cómo te llamás?',
        fields: [
            { name: 'name', label: 'Nombre completo', placeholder: 'Juan García', required: true },
        ],
    },
    {
        id: 'identity-email', type: 'text-fields', title: '¿Cuál es tu email?',
        fields: [
            { name: 'email', label: 'Email', placeholder: 'juan@ejemplo.com', required: true, validation: 'email' },
        ],
    },
    {
        id: 'identity-phone', type: 'text-fields', title: '¿Tu teléfono?',
        fields: [
            { name: 'phone', label: 'Teléfono', placeholder: '+54 11 1234-5678', validation: 'phone-ar' },
        ],
    },
    {
        id: 'identity-address', type: 'text-fields', title: '¿Dónde vivís?',
        fields: [
            { name: 'address', label: 'Dirección', placeholder: 'Av. Corrientes 1234, CABA', required: true },
        ],
    },
    {
        id: 'ageRange', type: 'segmented-cards', title: '¿Qué edad tenés?',
        options: [
            { value: '18-25', label: '18–25' },
            { value: '26-35', label: '26–35' },
            { value: '36-45', label: '36–45' },
            { value: '46-55', label: '46–55' },
            { value: '56+', label: '56+' },
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
]

// ══════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════

const ICONS: Record<string, React.ReactNode> = {
    dog: (
        <svg viewBox="0 0 64 64" fill="none">
            {/* Floppy ears */}
            <ellipse cx="16" cy="28" rx="8" ry="14" fill="#6366f1" transform="rotate(-15 16 28)" />
            <ellipse cx="48" cy="28" rx="8" ry="14" fill="#6366f1" transform="rotate(15 48 28)" />
            {/* Head */}
            <ellipse cx="32" cy="32" rx="18" ry="17" fill="#818cf8" />
            {/* Inner ears */}
            <ellipse cx="16" cy="27" rx="5" ry="10" fill="#a5b4fc" transform="rotate(-15 16 27)" />
            <ellipse cx="48" cy="27" rx="5" ry="10" fill="#a5b4fc" transform="rotate(15 48 27)" />
            {/* Muzzle */}
            <ellipse cx="32" cy="38" rx="10" ry="8" fill="#c7d2fe" />
            {/* Eyes */}
            <circle cx="24" cy="29" r="3.5" fill="#1e1b4b" />
            <circle cx="40" cy="29" r="3.5" fill="#1e1b4b" />
            <circle cx="25.5" cy="27.5" r="1.2" fill="white" />
            <circle cx="41.5" cy="27.5" r="1.2" fill="white" />
            {/* Nose */}
            <ellipse cx="32" cy="35" rx="3.5" ry="2.5" fill="#1e1b4b" />
            <ellipse cx="32" cy="34.5" rx="1.5" ry="0.8" fill="#4338ca" opacity="0.4" />
            {/* Tongue */}
            <path d="M30 38c0 0 1 5 2 5s2-5 2-5" fill="#f472b6" />
            {/* Mouth */}
            <path d="M28 37.5c2 1.5 6 1.5 8 0" stroke="#1e1b4b" strokeWidth="1" strokeLinecap="round" fill="none" />
        </svg>
    ),
    cat: (
        <svg viewBox="0 0 64 64" fill="none">
            {/* Ears */}
            <path d="M14 12l-2 20 14-8z" fill="#818cf8" />
            <path d="M50 12l2 20-14-8z" fill="#818cf8" />
            <path d="M16 15l-1 15 10-6z" fill="#c7d2fe" />
            <path d="M48 15l1 15-10-6z" fill="#c7d2fe" />
            {/* Head */}
            <ellipse cx="32" cy="36" rx="18" ry="16" fill="#818cf8" />
            {/* Inner face */}
            <ellipse cx="32" cy="38" rx="12" ry="10" fill="#a5b4fc" opacity="0.5" />
            {/* Eyes */}
            <ellipse cx="24" cy="33" rx="3.5" ry="4" fill="#1e1b4b" />
            <ellipse cx="40" cy="33" rx="3.5" ry="4" fill="#1e1b4b" />
            <ellipse cx="24" cy="33" rx="2" ry="3.5" fill="#4f46e5" />
            <ellipse cx="40" cy="33" rx="2" ry="3.5" fill="#4f46e5" />
            <circle cx="23" cy="31.5" r="1" fill="white" />
            <circle cx="39" cy="31.5" r="1" fill="white" />
            {/* Nose */}
            <path d="M30.5 39l1.5 1.5 1.5-1.5z" fill="#f472b6" />
            {/* Mouth */}
            <path d="M32 40.5c-2 2-4 2-5 1.5" stroke="#1e1b4b" strokeWidth="1" strokeLinecap="round" fill="none" />
            <path d="M32 40.5c2 2 4 2 5 1.5" stroke="#1e1b4b" strokeWidth="1" strokeLinecap="round" fill="none" />
            {/* Whiskers */}
            <line x1="19" y1="37" x2="8" y2="35" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="19" y1="40" x2="7" y2="41" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="19" y1="43" x2="9" y2="46" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="45" y1="37" x2="56" y2="35" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="45" y1="40" x2="57" y2="41" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="45" y1="43" x2="55" y2="46" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    ),
    bird: (
        <svg viewBox="0 0 64 64" fill="none">
            {/* Tail feathers */}
            <path d="M8 28c-2-4-3-10 0-12s6 4 8 8" fill="#6366f1" opacity="0.6" />
            <path d="M10 30c-3-2-6-8-4-11s7 2 9 6" fill="#818cf8" opacity="0.5" />
            {/* Body */}
            <ellipse cx="30" cy="32" rx="18" ry="13" fill="#818cf8" />
            <ellipse cx="30" cy="34" rx="14" ry="9" fill="#a5b4fc" opacity="0.4" />
            {/* Wing */}
            <path d="M20 26c4-6 14-8 20-4-2 2-8 6-14 6s-6-2-6-2z" fill="#6366f1" opacity="0.5" />
            {/* Head */}
            <circle cx="46" cy="24" r="9" fill="#818cf8" />
            <circle cx="46" cy="24" r="6" fill="#a5b4fc" opacity="0.3" />
            {/* Eye */}
            <circle cx="49" cy="22" r="2.5" fill="#1e1b4b" />
            <circle cx="50" cy="21" r="0.8" fill="white" />
            {/* Beak */}
            <path d="M55 25l8-2-3 4z" fill="#fbbf24" />
            <path d="M55 25l8-2-4 1z" fill="#f59e0b" />
            {/* Legs */}
            <path d="M25 44l-2 8m0 0l-3-1m3 1l3-1" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M33 44l1 8m0 0l-3-1m3 1l3-1" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            {/* Cheek blush */}
            <circle cx="43" cy="27" r="2" fill="#f472b6" opacity="0.3" />
        </svg>
    ),
    other: (
        <svg viewBox="0 0 64 64" fill="none">
            {/* Main pad */}
            <ellipse cx="32" cy="40" rx="14" ry="11" fill="#818cf8" />
            <ellipse cx="32" cy="39" rx="10" ry="7" fill="#a5b4fc" opacity="0.4" />
            {/* Toe pads */}
            <ellipse cx="18" cy="24" rx="6" ry="8" fill="#818cf8" transform="rotate(-15 18 24)" />
            <ellipse cx="28" cy="18" rx="5.5" ry="7.5" fill="#818cf8" transform="rotate(-5 28 18)" />
            <ellipse cx="38" cy="18" rx="5.5" ry="7.5" fill="#818cf8" transform="rotate(5 38 18)" />
            <ellipse cx="46" cy="24" rx="6" ry="8" fill="#818cf8" transform="rotate(15 46 24)" />
            {/* Toe highlights */}
            <ellipse cx="18" cy="22" rx="3" ry="4.5" fill="#a5b4fc" opacity="0.4" transform="rotate(-15 18 22)" />
            <ellipse cx="28" cy="16" rx="3" ry="4" fill="#a5b4fc" opacity="0.4" transform="rotate(-5 28 16)" />
            <ellipse cx="38" cy="16" rx="3" ry="4" fill="#a5b4fc" opacity="0.4" transform="rotate(5 38 16)" />
            <ellipse cx="46" cy="22" rx="3" ry="4.5" fill="#a5b4fc" opacity="0.4" transform="rotate(15 46 22)" />
        </svg>
    ),
    self: (
        <svg viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="20" r="10" fill="#818cf8" />
            <circle cx="32" cy="18" r="6" fill="#a5b4fc" opacity="0.3" />
            <path d="M16 54c0-12 7-18 16-18s16 6 16 18" fill="#a5b4fc" opacity="0.6" />
            <circle cx="29" cy="18" r="1.5" fill="#1e1b4b" /><circle cx="35" cy="18" r="1.5" fill="#1e1b4b" />
            <path d="M29 23c1.5 1.5 4.5 1.5 6 0" stroke="#1e1b4b" strokeWidth="1" strokeLinecap="round" fill="none" />
        </svg>
    ),
    gift: (
        <svg viewBox="0 0 64 64" fill="none">
            <rect x="14" y="30" width="36" height="22" rx="4" fill="#818cf8" />
            <rect x="14" y="24" width="36" height="10" rx="4" fill="#a5b4fc" />
            <rect x="29" y="24" width="6" height="28" fill="#6366f1" opacity="0.4" />
            <path d="M32 24c-3-6-8-10-12-8s-2 6 2 8h10z" fill="#c7d2fe" />
            <path d="M32 24c3-6 8-10 12-8s2 6-2 8H32z" fill="#e0e7ff" />
            <circle cx="32" cy="24" r="3" fill="#6366f1" />
        </svg>
    ),
    children: (
        <svg viewBox="0 0 48 48" fill="none">
            <circle cx="20" cy="14" r="7" fill="#818cf8" />
            <path d="M10 42c0-8 5-14 10-14s10 6 10 14" fill="#a5b4fc" opacity="0.5" />
            <circle cx="17.5" cy="13" r="1.2" fill="#1e1b4b" /><circle cx="22.5" cy="13" r="1.2" fill="#1e1b4b" />
            <circle cx="36" cy="18" r="5" fill="#a5b4fc" />
            <path d="M28 42c0-6 4-10 8-10s8 4 8 10" fill="#c7d2fe" opacity="0.5" />
            <circle cx="34.5" cy="17" r="1" fill="#1e1b4b" /><circle cx="37.5" cy="17" r="1" fill="#1e1b4b" />
        </svg>
    ),
    pets: (
        <svg viewBox="0 0 48 48" fill="none">
            <ellipse cx="24" cy="30" rx="10" ry="8" fill="#a5b4fc" />
            <ellipse cx="12" cy="18" rx="5" ry="6.5" fill="#818cf8" transform="rotate(-10 12 18)" />
            <ellipse cx="22" cy="13" rx="4.5" ry="6" fill="#818cf8" />
            <ellipse cx="32" cy="13" rx="4.5" ry="6" fill="#818cf8" />
            <ellipse cx="40" cy="18" rx="5" ry="6.5" fill="#818cf8" transform="rotate(10 40 18)" />
        </svg>
    ),
    outdoor: (
        <svg viewBox="0 0 48 48" fill="none">
            <rect x="8" y="24" width="32" height="16" rx="2" fill="#818cf8" opacity="0.3" />
            <path d="M8 24l16-14 16 14z" fill="#818cf8" />
            <path d="M12 24l12-10 12 10z" fill="#a5b4fc" opacity="0.3" />
            <rect x="20" y="30" width="8" height="10" rx="1.5" fill="#a5b4fc" />
            <circle cx="26" cy="35" r="1" fill="#6366f1" />
            <rect x="12" y="28" width="5" height="4" rx="0.5" fill="#c7d2fe" opacity="0.5" />
            <rect x="31" y="28" width="5" height="4" rx="0.5" fill="#c7d2fe" opacity="0.5" />
            <rect x="30" y="10" width="3" height="8" rx="1" fill="#818cf8" opacity="0.6" />
            <circle cx="40" cy="10" r="4" fill="#fbbf24" opacity="0.5" />
        </svg>
    ),
    presence: (
        <svg viewBox="0 0 48 48" fill="none">
            <rect x="8" y="12" width="32" height="24" rx="3" fill="#818cf8" opacity="0.3" />
            <rect x="12" y="16" width="24" height="16" rx="2" fill="#a5b4fc" opacity="0.3" />
            <rect x="8" y="36" width="32" height="4" rx="1" fill="#818cf8" opacity="0.4" />
            <circle cx="24" cy="24" r="6" fill="#818cf8" opacity="0.5" />
            <circle cx="24" cy="22" r="3" fill="#a5b4fc" />
            <path d="M19 29c0-3 2-5 5-5s5 2 5 5" fill="#a5b4fc" opacity="0.6" />
        </svg>
    ),
    apartment: (
        <svg viewBox="0 0 48 48" fill="none">
            <rect x="6" y="18" width="36" height="24" rx="2" fill="#818cf8" />
            <rect x="6" y="18" width="36" height="8" fill="#a5b4fc" opacity="0.5" />
            <line x1="6" y1="26" x2="42" y2="26" stroke="#6366f1" strokeWidth="1" opacity="0.5" />
            <line x1="6" y1="34" x2="42" y2="34" stroke="#6366f1" strokeWidth="1" opacity="0.5" />
            <rect x="12" y="22" width="5" height="4" rx="0.5" fill="#c7d2fe" />
            <rect x="22" y="22" width="5" height="4" rx="0.5" fill="#c7d2fe" />
            <rect x="32" y="22" width="5" height="4" rx="0.5" fill="#c7d2fe" />
            <rect x="12" y="30" width="5" height="4" rx="0.5" fill="#c7d2fe" />
            <rect x="22" y="30" width="5" height="4" rx="0.5" fill="#c7d2fe" />
            <rect x="32" y="30" width="5" height="4" rx="0.5" fill="#c7d2fe" />
        </svg>
    ),
    indoor: (
        <svg viewBox="0 0 48 48" fill="none">
            <rect x="8" y="8" width="32" height="28" rx="2" fill="#818cf8" opacity="0.4" />
            <rect x="14" y="14" width="20" height="16" rx="1" fill="#a5b4fc" opacity="0.5" />
            <path d="M22 14v16M26 14v16M14 22h20" stroke="#6366f1" strokeWidth="1.2" opacity="0.6" />
            <rect x="8" y="36" width="32" height="4" rx="1" fill="#818cf8" opacity="0.5" />
        </svg>
    ),
    unfenced: (
        <svg viewBox="0 0 48 48" fill="none">
            <path d="M8 38V18l16-10 16 10v20" stroke="#818cf8" strokeWidth="2" fill="none" strokeLinejoin="round" />
            <path d="M8 38V18l16-10 16 10v20" stroke="#a5b4fc" strokeWidth="1" fill="none" strokeLinejoin="round" opacity="0.5" />
            <line x1="8" y1="24" x2="40" y2="24" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.7" />
        </svg>
    ),
    decline: (
        <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="16" fill="#818cf8" opacity="0.3" />
            <circle cx="24" cy="24" r="12" fill="#a5b4fc" opacity="0.4" />
            <path d="M16 24h16" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
        </svg>
    ),
    maybe: (
        <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="14" fill="#818cf8" opacity="0.3" />
            <path d="M24 18v4M24 28v2" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="24" cy="34" r="2.5" fill="#6366f1" />
        </svg>
    ),
    sitter: (
        <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="14" r="8" fill="#818cf8" />
            <path d="M10 42c0-10 6-16 14-16s14 6 14 16" fill="#a5b4fc" opacity="0.6" />
            <path d="M20 28l4 4 8-10" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
    ),
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

    // File upload
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

    // ── Camera handlers removed — using native capture="user" instead ──

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
                            <div className="ps-toggle__label">
                                Acepto los{' '}
                                <a
                                    href="/terms"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ps-accent)', textDecoration: 'underline' }}
                                >
                                    Términos y Condiciones
                                </a>
                            </div>
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
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </span>
                            </button>
                        ))}
                    </div>
                    {answers.latitude && (
                        <div className="ps-geo-status">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#34d399" /><path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
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
                    ) : (
                        <>
                            {/* Native camera capture — works reliably on mobile */}
                            <label className="ps-btn ps-btn--primary" style={{ width: '100%', marginBottom: 'var(--ps-2)', justifyContent: 'center', cursor: 'pointer' }}>
                                📸 Tomar Selfie
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="user"
                                    style={{ display: 'none' }}
                                    onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                                />
                            </label>
                            {/* File picker / drag-and-drop for gallery */}
                            <div
                                className={`ps-upload-zone ${dragOver ? 'ps-upload-zone--dragover' : ''}`}
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0]) }}
                            >
                                <div style={{ fontSize: 40, marginBottom: 'var(--ps-1)' }}>📁</div>
                                <p style={{ color: 'var(--ps-text-secondary)', fontSize: 14, fontWeight: 600 }}>
                                    O elegí una foto de tu galería
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
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                    {/* Show text input when 'other' is selected on species step */}
                    {currentStep.id === 'species' && answers[currentStep.id] === 'other' && (
                        <div style={{ marginTop: 'var(--ps-3)' }}>
                            <input
                                className="ps-input"
                                placeholder="¿Qué animal buscás?"
                                value={answers.speciesOther || ''}
                                onChange={(e) => setAnswer('speciesOther', e.target.value)}
                                autoFocus
                            />
                        </div>
                    )}
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
                    {errors[currentStep.id] && <div className="ps-field__error">{errors[currentStep.id]}</div>}
                </div>
            )

            case 'pet-counter': {
                const counts = (answers[currentStep.id] as Record<string, number>) || {};
                const total = Object.values(counts).reduce((s, n) => s + n, 0);
                return (
                    <div className="ps-step" key={key}>
                        <h1 className="ps-title">{currentStep.title}</h1>
                        {currentStep.subtitle && <p className="ps-subtitle">{currentStep.subtitle}</p>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--ps-2)', marginTop: 'var(--ps-3)' }}>
                            {currentStep.petTypes.map(pt => {
                                const count = counts[pt.value] || 0;
                                return (
                                    <div key={pt.value} style={{ textAlign: 'center' }}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const updated = { ...counts, [pt.value]: count + 1 };
                                                setAnswer(currentStep.id, updated);
                                            }}
                                            style={{
                                                position: 'relative',
                                                width: 72,
                                                height: 72,
                                                borderRadius: 16,
                                                border: count > 0 ? '2px solid var(--ps-accent)' : '2px solid rgba(255,255,255,0.1)',
                                                background: count > 0 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                transition: 'all 0.15s',
                                                padding: 14,
                                            }}
                                        >
                                            {ICONS[pt.icon] || <span style={{ fontSize: 32 }}>🐾</span>}
                                            {count > 0 && (
                                                <span
                                                    style={{
                                                        position: 'absolute',
                                                        top: -6,
                                                        right: -6,
                                                        width: 24,
                                                        height: 24,
                                                        borderRadius: '50%',
                                                        background: 'var(--ps-accent)',
                                                        color: '#fff',
                                                        fontSize: 13,
                                                        fontWeight: 700,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                    }}
                                                    aria-hidden="true"
                                                >
                                                    {count}
                                                </span>
                                            )}
                                        </button>
                                        <div style={{ fontSize: 12, color: 'var(--ps-text-secondary)', marginTop: 6, fontWeight: 500 }}>
                                            {pt.label}
                                        </div>
                                        {count > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const updated = { ...counts, [pt.value]: Math.max(0, count - 1) };
                                                    if (updated[pt.value] === 0) delete updated[pt.value];
                                                    setAnswer(currentStep.id, updated);
                                                }}
                                                style={{
                                                    marginTop: 4, /* 4px: half-grid exception */
                                                    fontSize: 12,
                                                    fontWeight: 500,
                                                    color: 'var(--ps-accent)',
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: 0,
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline',
                                                }}
                                            >
                                                − Restar
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {total === 0 && (
                            <p style={{ textAlign: 'center', color: 'var(--ps-text-muted)', fontSize: 13, marginTop: 'var(--ps-3)' }}>
                                Si no tenés mascotas, continuá al siguiente paso
                            </p>
                        )}
                        {errors[currentStep.id] && <div className="ps-field__error">{errors[currentStep.id]}</div>}
                    </div>
                );
            }

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
                                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                {step > 0 && (
                    <button
                        className="ps-btn ps-btn--ghost"
                        onClick={goBack}
                    >
                        ← Atrás
                    </button>
                )}
                {step === 0 && <div />}
                <button
                    className="ps-btn ps-btn--primary"
                    onClick={goNext}
                    disabled={!canAdvance() || submitting}
                >
                    {submitting ? (
                        <><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" /><path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> Enviando...</>
                    ) : isLastStep ? (
                        <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8.5l2.5-7 12 6.5-12 6.5 2.5-7h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> Enviar</>
                    ) : 'Continuar →'}
                </button>
            </div>
        </div>
    )
}
