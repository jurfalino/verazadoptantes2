'use client';

export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import { useRouter } from 'next/navigation';

export default function TermsPage() {
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
                    {locale === 'es' ? <TermsES /> : <TermsEN />}
                </div>

                <div className="mt-6 text-center text-stone-400 text-xs">
                    {t('legal.last_updated')}: 2026-02-09
                </div>
            </div>
        </main>
    );
}

function TermsES() {
    return (
        <>
            <h1 className="text-2xl font-bold text-stone-900">Términos y Condiciones de Uso</h1>

            <p className="text-sm text-stone-500 italic">
                Al utilizar BuenAdoptante, aceptás los siguientes términos.
            </p>

            <h2>1. Descripción del servicio</h2>
            <p>
                BuenAdoptante es una plataforma colaborativa sin fines de lucro que permite a la comunidad rescatista
                compartir y consultar información sobre personas que adoptan animales, con el objetivo de
                prevenir adopciones irresponsables y proteger el bienestar animal.
            </p>

            <h2>2. Registro de información</h2>
            <p>Al registrar información sobre un adoptante en la plataforma, el usuario declara que:</p>
            <ul>
                <li>La información proporcionada es <strong>verdadera y basada en su experiencia directa</strong>.</li>
                <li>No publicará información <strong>falsa, difamatoria o malintencionada</strong>.</li>
                <li>Otorga a BuenAdoptante una <strong>licencia no exclusiva</strong> para almacenar, mostrar y procesar los datos proporcionados dentro de la plataforma.</li>
                <li>Es <strong>responsable legal</strong> del contenido que publica. BuenAdoptante no verifica la exactitud de la información.</li>
            </ul>

            <h2>3. Precisión de la información</h2>
            <p>
                BuenAdoptante <strong>no verifica la exactitud</strong> de la información publicada por los usuarios.
                Los perfiles de adoptantes son creados y mantenidos por la comunidad.
                La plataforma no asume responsabilidad por decisiones tomadas en base a la información mostrada.
            </p>

            <h2>4. Uso prohibido</h2>
            <p>Está prohibido utilizar la plataforma para:</p>
            <ul>
                <li><strong>Acosar, amenazar o intimidar</strong> a cualquier persona.</li>
                <li>Publicar información <strong>falsa</strong> con intención de perjudicar.</li>
                <li>Utilizar los datos para fines <strong>comerciales, publicitarios o ajenos</strong> a la protección animal.</li>
                <li><strong>Recopilar masivamente</strong> datos de la plataforma (scraping).</li>
            </ul>

            <h2>5. Moderación y remoción de contenido</h2>
            <p>
                BuenAdoptante se reserva el derecho de <strong>modificar o eliminar</strong> cualquier contenido que:
            </p>
            <ul>
                <li>Viole estos términos.</li>
                <li>Sea reportado como inexacto o difamatorio.</li>
                <li>Sea objeto de un reclamo legítimo del titular de los datos (derechos ARCO, Ley 25.326).</li>
            </ul>

            <h2 id="disputes">6. Disputas y reclamos</h2>
            <p>
                Si considerás que un perfil contiene información inexacta o afecta tus derechos:
            </p>
            <ol>
                <li>Contactános a <strong>privacidad@buenadoptante.com</strong> indicando tu nombre, el perfil en cuestión y la información que deseás que se corrija o elimine.</li>
                <li>Evaluaremos tu solicitud dentro de los <strong>10 días hábiles</strong>.</li>
                <li>En caso de información manifiestamente falsa o difamatoria, procederemos a la remoción inmediata.</li>
            </ol>

            <h2>7. Limitación de responsabilidad</h2>
            <p>
                BuenAdoptante actúa como <strong>intermediario tecnológico</strong>. No es responsable por:
            </p>
            <ul>
                <li>La veracidad de la información proporcionada por los usuarios.</li>
                <li>Daños derivados del uso de la información mostrada en la plataforma.</li>
                <li>Decisiones de adopción tomadas en base a los perfiles.</li>
            </ul>
            <p>
                Los usuarios que publiquen información son los <strong>únicos responsables legales</strong> de su contenido
                conforme al Código Civil y Comercial (Arts. 1770-1771) y la Ley 26.032 de Libertad de Expresión.
            </p>

            <h2>8. Propiedad intelectual</h2>
            <p>
                Los usuarios conservan la autoría de los textos e imágenes que publican,
                pero otorgan a BuenAdoptante una licencia para usarlos dentro de la plataforma.
                El código y diseño de la plataforma son propiedad de sus desarrolladores.
            </p>

            <h2>9. Modificaciones</h2>
            <p>
                BuenAdoptante podrá modificar estos términos en cualquier momento.
                El uso continuado de la plataforma implica la aceptación de los términos vigentes.
            </p>

            <h2>10. Legislación aplicable</h2>
            <p>
                Estos términos se rigen por las leyes de la <strong>República Argentina</strong>.
                Para cualquier controversia serán competentes los tribunales ordinarios de la
                Ciudad Autónoma de Buenos Aires.
            </p>
        </>
    );
}

function TermsEN() {
    return (
        <>
            <h1 className="text-2xl font-bold text-stone-900">Terms and Conditions of Use</h1>

            <p className="text-sm text-stone-500 italic">
                By using BuenAdoptante, you agree to the following terms.
            </p>

            <h2>1. Service description</h2>
            <p>
                BuenAdoptante is a non-profit collaborative platform that allows the animal rescue community
                to share and query information about people who adopt animals, with the goal of
                preventing irresponsible adoptions and protecting animal welfare.
            </p>

            <h2>2. Information registration</h2>
            <p>By registering information about an adopter on the platform, the user declares that:</p>
            <ul>
                <li>The information provided is <strong>truthful and based on their direct experience</strong>.</li>
                <li>They will not publish <strong>false, defamatory, or malicious</strong> information.</li>
                <li>They grant BuenAdoptante a <strong>non-exclusive license</strong> to store, display, and process the submitted data within the platform.</li>
                <li>They are <strong>legally responsible</strong> for the content they publish. BuenAdoptante does not verify the accuracy of information.</li>
            </ul>

            <h2>3. Information accuracy</h2>
            <p>
                BuenAdoptante <strong>does not verify the accuracy</strong> of information published by users.
                Adopter profiles are created and maintained by the community.
                The platform assumes no responsibility for decisions made based on the information displayed.
            </p>

            <h2>4. Prohibited use</h2>
            <p>It is prohibited to use the platform to:</p>
            <ul>
                <li><strong>Harass, threaten, or intimidate</strong> any person.</li>
                <li>Publish <strong>false</strong> information with intent to harm.</li>
                <li>Use the data for <strong>commercial, advertising, or purposes</strong> unrelated to animal protection.</li>
                <li><strong>Mass-collect</strong> data from the platform (scraping).</li>
            </ul>

            <h2>5. Moderation and content removal</h2>
            <p>
                BuenAdoptante reserves the right to <strong>modify or remove</strong> any content that:
            </p>
            <ul>
                <li>Violates these terms.</li>
                <li>Is reported as inaccurate or defamatory.</li>
                <li>Is subject to a legitimate data subject request (ARCO rights, Law 25.326).</li>
            </ul>

            <h2 id="disputes">6. Disputes and claims</h2>
            <p>
                If you believe a profile contains inaccurate information or affects your rights:
            </p>
            <ol>
                <li>Contact us at <strong>privacidad@buenadoptante.com</strong> indicating your name, the profile in question, and the information you want corrected or removed.</li>
                <li>We will review your request within <strong>10 business days</strong>.</li>
                <li>In cases of manifestly false or defamatory information, we will proceed with immediate removal.</li>
            </ol>

            <h2>7. Limitation of liability</h2>
            <p>
                BuenAdoptante acts as a <strong>technological intermediary</strong>. It is not responsible for:
            </p>
            <ul>
                <li>The truthfulness of information provided by users.</li>
                <li>Damages arising from the use of information displayed on the platform.</li>
                <li>Adoption decisions made based on profiles.</li>
            </ul>
            <p>
                Users who publish information are the <strong>sole legal parties responsible</strong> for their content
                under the Civil and Commercial Code (Arts. 1770-1771) and Law 26.032 on Freedom of Expression.
            </p>

            <h2>8. Intellectual property</h2>
            <p>
                Users retain authorship of texts and images they publish,
                but grant BuenAdoptante a license to use them within the platform.
                The platform&apos;s code and design are the property of its developers.
            </p>

            <h2>9. Modifications</h2>
            <p>
                BuenAdoptante may modify these terms at any time.
                Continued use of the platform implies acceptance of the current terms.
            </p>

            <h2>10. Applicable law</h2>
            <p>
                These terms are governed by the laws of the <strong>Argentine Republic</strong>.
                For any disputes, the ordinary courts of the
                Ciudad Autónoma de Buenos Aires shall have jurisdiction.
            </p>
        </>
    );
}
