'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useRouter } from 'next/navigation';

export default function PrivacyPage() {
    const { t, locale } = useLanguage();
    const router = useRouter();

    return (
        <main className="min-h-screen bg-stone-50 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button
                    onClick={() => router.back()}
                    className="text-teal-600 hover:text-teal-800 text-sm mb-6 flex items-center gap-1"
                >
                    ← {t('common.back')}
                </button>

                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 prose prose-stone max-w-none">
                    {locale === 'es' ? <PrivacyES /> : <PrivacyEN />}
                </div>

                <div className="mt-6 text-center text-stone-400 text-xs">
                    {t('legal.last_updated')}: 2026-02-09
                </div>
            </div>
        </main>
    );
}

function PrivacyES() {
    return (
        <>
            <h1 className="text-2xl font-bold text-stone-900">Política de Privacidad</h1>

            <p className="text-sm text-stone-500 italic">
                Responsable: BuenAdoptante — Plataforma colaborativa de verificación de adoptantes de animales.
            </p>

            <h2>1. ¿Qué datos recopilamos?</h2>
            <p>BuenAdoptante almacena información proporcionada por usuarios de la comunidad rescatista con el fin de proteger el bienestar animal. Los datos pueden incluir:</p>
            <ul>
                <li><strong>Datos de identificación:</strong> nombre completo o parcial del adoptante.</li>
                <li><strong>Datos de contacto:</strong> teléfono, correo electrónico, redes sociales, dirección.</li>
                <li><strong>Datos de adopción:</strong> historial de adopciones, especie del animal, fecha, calificación de la experiencia.</li>
                <li><strong>Observaciones:</strong> comentarios de otros rescatistas sobre la experiencia de adopción.</li>
                <li><strong>Imágenes:</strong> fotografías adjuntas a los registros de adopción.</li>
            </ul>

            <h2>2. ¿Con qué base legal tratamos los datos?</h2>
            <p>
                El tratamiento se fundamenta en el <strong>interés legítimo</strong> (Art. 5 inc. 2.d, Ley 25.326) de la comunidad rescatista
                para prevenir adopciones irresponsables, abandono y maltrato animal, en concordancia con la
                Ley 14.346 de Protección Animal.
            </p>
            <p>
                Los datos no se utilizan con fines comerciales, publicitarios ni se comparten con terceros fuera de la plataforma.
            </p>

            <h2>3. ¿Quién puede ver los datos?</h2>
            <ul>
                <li><strong>Usuarios no registrados:</strong> pueden ver datos parcialmente ocultos (nombre e información de contacto enmascarados).</li>
                <li><strong>Usuarios registrados:</strong> pueden ver los datos completos del perfil.</li>
                <li><strong>Administradores:</strong> tienen acceso completo para fines de moderación y gestión.</li>
            </ul>

            <h2>4. ¿Cuánto tiempo conservamos los datos?</h2>
            <p>
                Los perfiles se conservan mientras sean relevantes para la comunidad rescatista.
                Perfiles sin actividad por más de 2 años podrán ser archivados automáticamente.
            </p>

            <h2>5. Tus derechos (ARCO)</h2>
            <p>
                Conforme a la Ley 25.326, toda persona cuyos datos figuren en la plataforma tiene derecho a:
            </p>
            <ul>
                <li><strong>Acceso:</strong> conocer qué información almacenamos sobre vos.</li>
                <li><strong>Rectificación:</strong> solicitar la corrección de datos inexactos.</li>
                <li><strong>Cancelación (supresión):</strong> solicitar la eliminación de tus datos.</li>
                <li><strong>Oposición:</strong> oponerte al tratamiento de tus datos.</li>
            </ul>
            <p>
                Para ejercer estos derechos, podés contactarnos enviando un correo a{' '}
                <strong>privacidad@buenadoptante.com</strong> indicando tu nombre completo y el derecho que deseás ejercer.
                Responderemos dentro de los <strong>10 días hábiles</strong> establecidos por ley.
            </p>

            <h2>6. Seguridad</h2>
            <p>
                Implementamos medidas técnicas para proteger los datos: acceso autenticado,
                enmascaramiento de información sensible para usuarios no registrados, y registros de auditoría.
            </p>

            <h2>7. Contacto</h2>
            <p>
                Para consultas sobre privacidad: <strong>privacidad@buenadoptante.com</strong>
            </p>

            <h2>8. Autoridad de control</h2>
            <p>
                Si considerás que tus derechos no han sido debidamente atendidos, podés presentar una denuncia ante la{' '}
                <strong>Agencia de Acceso a la Información Pública (AAIP)</strong> —{' '}
            </p>
        </>
    );
}

function PrivacyEN() {
    return (
        <>
            <h1 className="text-2xl font-bold text-stone-900">Privacy Policy</h1>

            <p className="text-sm text-stone-500 italic">
                Responsible party: BuenAdoptante — Collaborative platform for vetting animal adopters.
            </p>

            <h2>1. What data do we collect?</h2>
            <p>BuenAdoptante stores information provided by members of the animal rescue community to protect animal welfare. Data may include:</p>
            <ul>
                <li><strong>Identification data:</strong> full or partial name of the adopter.</li>
                <li><strong>Contact data:</strong> phone, email, social media, address.</li>
                <li><strong>Adoption data:</strong> adoption history, animal species, date, experience rating.</li>
                <li><strong>Observations:</strong> comments from other rescuers about the adoption experience.</li>
                <li><strong>Images:</strong> photographs attached to adoption records.</li>
            </ul>

            <h2>2. What is our legal basis?</h2>
            <p>
                Data processing is based on <strong>legitimate interest</strong> (Art. 5 inc. 2.d, Argentine Law 25.326) of the
                rescue community to prevent irresponsible adoptions, abandonment, and animal abuse, in accordance with
                Animal Protection Law 14.346.
            </p>
            <p>
                Data is not used for commercial or advertising purposes and is not shared with third parties outside the platform.
            </p>

            <h2>3. Who can see the data?</h2>
            <ul>
                <li><strong>Unregistered users:</strong> can see partially masked data (name and contact info obscured).</li>
                <li><strong>Registered users:</strong> can see full profile data.</li>
                <li><strong>Administrators:</strong> have full access for moderation and management purposes.</li>
            </ul>

            <h2>4. How long do we keep the data?</h2>
            <p>
                Profiles are kept as long as they are relevant to the rescue community.
                Profiles with no activity for more than 2 years may be automatically archived.
            </p>

            <h2>5. Your rights (ARCO)</h2>
            <p>
                Under Argentine Law 25.326, any person whose data appears on the platform has the right to:
            </p>
            <ul>
                <li><strong>Access:</strong> know what information we store about you.</li>
                <li><strong>Rectification:</strong> request correction of inaccurate data.</li>
                <li><strong>Cancellation (deletion):</strong> request deletion of your data.</li>
                <li><strong>Opposition:</strong> object to the processing of your data.</li>
            </ul>
            <p>
                To exercise these rights, contact us at{' '}
                <strong>privacidad@buenadoptante.com</strong> with your full name and the right you wish to exercise.
                We will respond within <strong>10 business days</strong> as required by law.
            </p>

            <h2>6. Security</h2>
            <p>
                We implement technical measures to protect data: authenticated access,
                masking of sensitive information for unregistered users, and audit logs.
            </p>

            <h2>7. Contact</h2>
            <p>
                For privacy inquiries: <strong>privacidad@buenadoptante.com</strong>
            </p>

            <h2>8. Supervisory authority</h2>
            <p>
                If you believe your rights have not been adequately addressed, you may file a complaint with the{' '}
                <strong>Agencia de Acceso a la Información Pública (AAIP)</strong> —{' '}
            </p>
        </>
    );
}
