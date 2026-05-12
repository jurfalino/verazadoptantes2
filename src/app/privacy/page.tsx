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
                    className="text-teal-700 hover:text-teal-800 text-sm mb-6 flex items-center gap-1"
                >
                    ← {t('common.back')}
                </button>

                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 prose prose-stone max-w-none">
                    {locale === 'es' ? <PrivacyES /> : <PrivacyEN />}
                </div>

                <div className="mt-6 text-center text-stone-500 text-xs">
                    {t('legal.last_updated')}: 2026-05-12
                </div>
            </div>
        </main>
    );
}

function PrivacyES() {
    return (
        <>
            <h1 className="text-2xl font-semibold text-stone-900">Política de Privacidad Global — BuenAdoptante</h1>

            <p className="text-sm text-stone-500 italic">
                Responsable: BuenAdoptante — Plataforma colaborativa de verificación de adoptantes de animales.
            </p>

            <h2>1. ¿Qué datos recopilamos?</h2>
            <p>
                BuenAdoptante almacena información proporcionada voluntariamente por la comunidad rescatista
                con el fin exclusivo de proteger el bienestar animal. Los datos incluyen:
            </p>
            <ul>
                <li><strong>Identificación:</strong> nombre completo o parcial del adoptante.</li>
                <li><strong>Contacto:</strong> teléfono, correo electrónico, redes sociales o ubicación general.</li>
                <li><strong>Historial:</strong> especie del animal, fecha de adopción y calificación de la experiencia.</li>
                <li><strong>Observaciones:</strong> comentarios y valoraciones de rescatistas sobre la experiencia.</li>
                <li><strong>Evidencia:</strong> fotografías adjuntas para respaldar los registros.</li>
            </ul>

            <h2>2. Base Legal del Tratamiento</h2>
            <p>
                El tratamiento de estos datos se fundamenta en el <strong>interés legítimo</strong> de la comunidad
                para prevenir el maltrato, el abandono y la crueldad animal, en concordancia con las normas
                locales de protección animal y las excepciones previstas en las leyes de protección de datos
                personales para fines de seguridad y bienestar general.
            </p>
            <p>
                Los datos no se comercializan, no se utilizan con fines publicitarios ni se comparten con
                terceros ajenos a la plataforma.
            </p>

            <h2>3. Niveles de Acceso</h2>
            <ul>
                <li><strong>Público (no registrado):</strong> solo puede visualizar datos enmascarados (ej. J*** P****) para proteger la privacidad básica.</li>
                <li><strong>Usuarios registrados (rescatistas):</strong> acceso al perfil completo para evaluar la idoneidad del adoptante.</li>
                <li><strong>Administradores:</strong> acceso total para moderación, gestión de denuncias y mantenimiento.</li>
            </ul>

            <h2>4. Conservación de Datos</h2>
            <p>
                La información se conservará mientras sea útil para la seguridad de los animales.
                Los registros sin actividad o relevancia tras un periodo prolongado (mínimo 2 años) podrán
                ser anonimizados o eliminados de forma definitiva.
            </p>

            <h2>5. Tus Derechos (ARCO)</h2>
            <p>
                Independientemente de tu país de residencia, garantizamos el ejercicio de tus derechos:
            </p>
            <ul>
                <li><strong>Acceso:</strong> conocer qué información tenemos sobre ti.</li>
                <li><strong>Rectificación:</strong> corregir datos inexactos o desactualizados.</li>
                <li><strong>Cancelación (supresión):</strong> solicitar la eliminación de tus datos de nuestra base.</li>
                <li><strong>Oposición:</strong> negarte al tratamiento de tus datos por motivos legítimos.</li>
            </ul>
            <p>
                Para ejercer estos derechos, contactanos en <strong>privacidad@buenadoptante.com</strong>.
                Las solicitudes se procesarán en los plazos establecidos por la normativa local vigente
                de tu país (usualmente entre 10 y 15 días hábiles).
            </p>

            <h2>6. Seguridad y Confidencialidad</h2>
            <p>
                Implementamos medidas técnicas de estándar internacional: cifrado de datos, acceso autenticado
                y registros de auditoría para evitar el uso indebido de la plataforma.
            </p>

            <h2>7. Autoridad de Control</h2>
            <p>
                Si consideras que el tratamiento de tus datos infringe las normas de tu país, tienes derecho
                a presentar una reclamación ante la <strong>Autoridad de Protección de Datos Personales</strong>
                u organismo equivalente en tu jurisdicción nacional.
            </p>
        </>
    );
}

function PrivacyEN() {
    return (
        <>
            <h1 className="text-2xl font-semibold text-stone-900">Global Privacy Policy — BuenAdoptante</h1>

            <p className="text-sm text-stone-500 italic">
                Data controller: BuenAdoptante — Collaborative platform for vetting animal adopters.
            </p>

            <h2>1. What data do we collect?</h2>
            <p>
                BuenAdoptante stores information voluntarily provided by the animal rescue community for the
                sole purpose of protecting animal welfare. The data includes:
            </p>
            <ul>
                <li><strong>Identification:</strong> full or partial name of the adopter.</li>
                <li><strong>Contact:</strong> phone, email, social media, or general location.</li>
                <li><strong>History:</strong> animal species, adoption date, and experience rating.</li>
                <li><strong>Observations:</strong> comments and assessments from rescuers about the experience.</li>
                <li><strong>Evidence:</strong> photographs attached as record support.</li>
            </ul>

            <h2>2. Legal Basis for Processing</h2>
            <p>
                Processing of this data is based on the <strong>legitimate interest</strong> of the community
                to prevent animal mistreatment, abandonment, and cruelty, consistent with local animal-welfare
                regulations and the exceptions provided by personal-data-protection laws for general safety
                and welfare purposes.
            </p>
            <p>
                Data is not sold, is not used for advertising purposes, and is not shared with third parties
                outside the platform.
            </p>

            <h2>3. Access Levels</h2>
            <ul>
                <li><strong>Public (unregistered):</strong> can only view masked data (e.g. J*** P****) to protect basic privacy.</li>
                <li><strong>Registered users (rescuers):</strong> access the complete profile to assess the adopter&apos;s suitability.</li>
                <li><strong>Administrators:</strong> full access for moderation, complaint handling, and maintenance.</li>
            </ul>

            <h2>4. Data Retention</h2>
            <p>
                Information will be retained for as long as it is useful for animal safety. Records without
                activity or relevance after an extended period (minimum 2 years) may be anonymised or
                permanently deleted.
            </p>

            <h2>5. Your Rights (ARCO)</h2>
            <p>
                Regardless of your country of residence, we guarantee the exercise of your rights:
            </p>
            <ul>
                <li><strong>Access:</strong> know what information we hold about you.</li>
                <li><strong>Rectification:</strong> correct inaccurate or out-of-date data.</li>
                <li><strong>Cancellation (deletion):</strong> request removal of your data from our database.</li>
                <li><strong>Opposition:</strong> refuse the processing of your data on legitimate grounds.</li>
            </ul>
            <p>
                To exercise these rights, contact us at <strong>privacidad@buenadoptante.com</strong>.
                Requests will be processed within the timeframes established by the data-protection
                regulations in force in your country (usually between 10 and 15 business days).
            </p>

            <h2>6. Security and Confidentiality</h2>
            <p>
                We implement technical measures of international standard: data encryption, authenticated
                access, and audit logs to prevent misuse of the platform.
            </p>

            <h2>7. Supervisory Authority</h2>
            <p>
                If you believe that the processing of your data violates the rules of your country, you have
                the right to file a complaint with the <strong>Data Protection Authority</strong> or equivalent
                body in your national jurisdiction.
            </p>
        </>
    );
}
