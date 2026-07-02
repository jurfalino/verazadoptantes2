'use client';

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
                    className="text-teal-700 hover:text-teal-800 text-sm mb-6 flex items-center gap-1"
                >
                    ← {t('common.back')}
                </button>

                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 prose prose-stone max-w-none">
                    {locale === 'en' ? <TermsEN /> : locale === 'pt' ? <TermsPT /> : <TermsES />}
                </div>

                <div className="mt-6 text-center text-stone-500 text-xs">
                    {t('legal.last_updated')}: 2026-05-12
                </div>
            </div>
        </main>
    );
}

function TermsES() {
    return (
        <>
            <h1 className="text-2xl font-semibold text-stone-900">Términos y Condiciones de Uso — BuenAdoptante</h1>

            <p className="text-sm text-stone-500 italic">
                Al utilizar BuenAdoptante, aceptas los siguientes términos y condiciones.
                Si no estás de acuerdo con ellos, deberás abstenerte de utilizar la plataforma.
            </p>

            <h2>1. Descripción del Servicio</h2>
            <p>
                BuenAdoptante es una plataforma colaborativa, sin fines de lucro, diseñada para que la comunidad
                rescatista comparta y consulte información sobre adoptantes de animales. El objetivo primordial
                es la prevención del maltrato, el abandono y la promoción del bienestar animal a través de la
                transparencia informativa.
            </p>

            <h2 id="content-responsibility">2. Responsabilidad del Usuario sobre el Contenido</h2>
            <p>Al registrar información sobre un tercero, el usuario declara y garantiza que:</p>
            <ul>
                <li><strong>Veracidad:</strong> la información es veraz, está basada en su experiencia directa y se ingresa de buena fe.</li>
                <li><strong>Interés Legítimo:</strong> actúa bajo un interés legítimo de protección animal, orientado a prevenir daños a seres sintientes, conforme a las normativas de bienestar animal locales e internacionales.</li>
                <li><strong>Privacidad:</strong> no publicará datos sensibles (salud, creencias, orientación sexual, situación financiera, etc.) que no sean estrictamente necesarios para la finalidad de protección de la plataforma.</li>
                <li><strong>Imágenes:</strong> las fotografías subidas cuentan con el consentimiento implícito o explícito de quienes aparecen en ellas, o han sido tomadas en el marco de una transacción de adopción pública o privada.</li>
                <li><strong>Responsabilidad Legal:</strong> el usuario es el único responsable legal por el contenido que publique. BuenAdoptante no asume responsabilidad alguna ante reclamos por difamación, calumnias o infracción de derechos de terceros derivados de las publicaciones de los usuarios.</li>
            </ul>

            <h2>3. Precisión de la Información</h2>
            <p>
                BuenAdoptante actúa como un repositorio colaborativo y no verifica de forma independiente la
                exactitud de la información publicada por los usuarios. La plataforma no se responsabiliza por
                las decisiones de adopción tomadas basadas en el historial o rating mostrado en los perfiles.
            </p>

            <h2>4. Usos Prohibidos</h2>
            <p>Está estrictamente prohibido utilizar la plataforma para:</p>
            <ul>
                <li>Acosar, amenazar, discriminar o intimidar a cualquier persona.</li>
                <li>Publicar información falsa con el fin deliberado de perjudicar la reputación de terceros.</li>
                <li>Utilizar los datos para fines comerciales, de marketing o cualquier fin ajeno al bienestar animal.</li>
                <li>Extracción masiva de datos (scraping) mediante procesos automatizados.</li>
            </ul>

            <h2>5. Moderación y Remoción de Contenido</h2>
            <p>BuenAdoptante se reserva el derecho de modificar o eliminar contenido que:</p>
            <ul>
                <li>Infrinja estos términos.</li>
                <li>Sea reportado como manifiestamente falso o malintencionado.</li>
                <li>Sea objeto de un reclamo legítimo por parte del titular de los datos en ejercicio de sus derechos de protección de datos personales.</li>
            </ul>

            <h2 id="disputes">6. Disputas y Reclamos</h2>
            <p>
                Si consideras que un perfil contiene información inexacta o afecta tus derechos fundamentales:
            </p>
            <ul>
                <li>Contacta a <strong>privacidad@buenadoptante.com</strong> detallando el perfil y la información en cuestión.</li>
                <li>La plataforma evaluará la solicitud según la evidencia presentada y los plazos establecidos por la normativa local de protección de datos.</li>
                <li>En casos de falsedad evidente, se procederá a la remoción o rectificación inmediata.</li>
            </ul>

            <h2>7. Limitación de Responsabilidad</h2>
            <p>
                BuenAdoptante es un intermediario tecnológico. En la medida máxima permitida por la ley
                aplicable, la plataforma no será responsable por:
            </p>
            <ul>
                <li>Daños directos o indirectos derivados del uso de la información compartida por otros usuarios.</li>
                <li>Cualquier conflicto legal entre rescatistas y adoptantes.</li>
                <li>La veracidad de los testimonios y calificaciones.</li>
            </ul>

            <h2>8. Propiedad Intelectual</h2>
            <p>
                Los usuarios conservan la autoría de sus relatos e imágenes, otorgando a BuenAdoptante una
                licencia gratuita y no exclusiva para su visualización y procesamiento dentro del servicio.
                El diseño, software y marcas de BuenAdoptante son propiedad exclusiva de sus desarrolladores.
            </p>

            <h2>9. Modificaciones</h2>
            <p>
                La plataforma podrá actualizar estos términos en cualquier momento. El uso continuo del
                servicio tras la publicación de cambios constituye la aceptación de los nuevos términos.
            </p>

            <h2>10. Legislación Aplicable y Jurisdicción</h2>
            <p>
                Estos términos se rigen por los principios generales del derecho y las leyes de protección
                de datos y bienestar animal vigentes en el país de residencia del usuario. Para cualquier
                controversia, las partes acuerdan someterse a la jurisdicción de los tribunales competentes
                en el domicilio del titular de la plataforma o, en su defecto, donde se haya originado el
                registro de los datos.
            </p>
        </>
    );
}

function TermsEN() {
    return (
        <>
            <h1 className="text-2xl font-semibold text-stone-900">Terms and Conditions of Use — BuenAdoptante</h1>

            <p className="text-sm text-stone-500 italic">
                By using BuenAdoptante, you accept the following terms and conditions.
                If you do not agree with them, you must refrain from using the platform.
            </p>

            <h2>1. Service Description</h2>
            <p>
                BuenAdoptante is a non-profit collaborative platform designed for the animal rescue community
                to share and consult information about animal adopters. The primary objective is the prevention
                of mistreatment, abandonment, and the promotion of animal welfare through informational
                transparency.
            </p>

            <h2 id="content-responsibility">2. User Responsibility for Content</h2>
            <p>When registering information about a third party, the user declares and warrants that:</p>
            <ul>
                <li><strong>Truthfulness:</strong> the information is truthful, based on their direct experience, and entered in good faith.</li>
                <li><strong>Legitimate Interest:</strong> they act under a legitimate animal-protection interest, aimed at preventing harm to sentient beings, in accordance with local and international animal-welfare regulations.</li>
                <li><strong>Privacy:</strong> they will not publish sensitive data (health, beliefs, sexual orientation, financial situation, etc.) that is not strictly necessary for the platform&apos;s protective purpose.</li>
                <li><strong>Images:</strong> uploaded photographs carry the implicit or explicit consent of those who appear in them, or were taken in the context of a public or private adoption transaction.</li>
                <li><strong>Legal Responsibility:</strong> the user is the sole legal party responsible for the content they publish. BuenAdoptante assumes no liability for claims of defamation, slander, or infringement of third-party rights arising from user publications.</li>
            </ul>

            <h2>3. Information Accuracy</h2>
            <p>
                BuenAdoptante acts as a collaborative repository and does not independently verify the accuracy
                of the information published by users. The platform is not responsible for adoption decisions
                made based on the history or rating shown in profiles.
            </p>

            <h2>4. Prohibited Uses</h2>
            <p>It is strictly prohibited to use the platform to:</p>
            <ul>
                <li>Harass, threaten, discriminate against, or intimidate any person.</li>
                <li>Publish false information with the deliberate intent to harm the reputation of third parties.</li>
                <li>Use the data for commercial, marketing, or any other purpose unrelated to animal welfare.</li>
                <li>Carry out mass data extraction (scraping) via automated processes.</li>
            </ul>

            <h2>5. Moderation and Content Removal</h2>
            <p>BuenAdoptante reserves the right to modify or remove content that:</p>
            <ul>
                <li>Violates these terms.</li>
                <li>Is reported as manifestly false or malicious.</li>
                <li>Is the subject of a legitimate claim by the data subject in the exercise of their personal-data-protection rights.</li>
            </ul>

            <h2 id="disputes">6. Disputes and Claims</h2>
            <p>
                If you believe that a profile contains inaccurate information or affects your fundamental rights:
            </p>
            <ul>
                <li>Contact <strong>privacidad@buenadoptante.com</strong> detailing the profile and the information in question.</li>
                <li>The platform will evaluate the request based on the evidence provided and the timeframes established by local data-protection regulations.</li>
                <li>In cases of clear falsehood, immediate removal or rectification will proceed.</li>
            </ul>

            <h2>7. Limitation of Liability</h2>
            <p>
                BuenAdoptante is a technological intermediary. To the maximum extent permitted by applicable
                law, the platform will not be liable for:
            </p>
            <ul>
                <li>Direct or indirect damages arising from the use of information shared by other users.</li>
                <li>Any legal conflict between rescuers and adopters.</li>
                <li>The truthfulness of testimonies and ratings.</li>
            </ul>

            <h2>8. Intellectual Property</h2>
            <p>
                Users retain authorship of their accounts and images, granting BuenAdoptante a free,
                non-exclusive license for their display and processing within the service. The design,
                software, and trademarks of BuenAdoptante are the exclusive property of its developers.
            </p>

            <h2>9. Modifications</h2>
            <p>
                The platform may update these terms at any time. Continued use of the service after the
                publication of changes constitutes acceptance of the new terms.
            </p>

            <h2>10. Applicable Law and Jurisdiction</h2>
            <p>
                These terms are governed by general principles of law and the data-protection and
                animal-welfare laws in force in the user&apos;s country of residence. For any dispute,
                the parties agree to submit to the jurisdiction of the competent courts at the platform
                operator&apos;s domicile or, failing that, where the data was originally registered.
            </p>
        </>
    );
}

// ⚠️ DRAFT pt-BR legal text — pending human/legal review. es/en are the reviewed versions.
function TermsPT() {
    return (
        <>
            <h1 className="text-2xl font-semibold text-stone-900">Termos e Condições de Uso — BuenAdoptante</h1>

            <p className="text-sm text-stone-500 italic">
                Ao utilizar o BuenAdoptante, você aceita os seguintes termos e condições.
                Se você não concordar com eles, deverá abster-se de utilizar a plataforma.
            </p>

            <h2>1. Descrição do Serviço</h2>
            <p>
                O BuenAdoptante é uma plataforma colaborativa, sem fins lucrativos, projetada para que a comunidade
                de resgatistas compartilhe e consulte informações sobre adotantes de animais. O objetivo primordial
                é a prevenção dos maus-tratos, do abandono e a promoção do bem-estar animal por meio da
                transparência informativa.
            </p>

            <h2 id="content-responsibility">2. Responsabilidade do Usuário sobre o Conteúdo</h2>
            <p>Ao registrar informações sobre um terceiro, o usuário declara e garante que:</p>
            <ul>
                <li><strong>Veracidade:</strong> as informações são verídicas, baseiam-se em sua experiência direta e são inseridas de boa-fé.</li>
                <li><strong>Interesse Legítimo:</strong> atua sob um interesse legítimo de proteção animal, voltado a prevenir danos a seres sencientes, conforme as normas de bem-estar animal locais e internacionais.</li>
                <li><strong>Privacidade:</strong> não publicará dados sensíveis (saúde, crenças, orientação sexual, situação financeira, etc.) que não sejam estritamente necessários para a finalidade de proteção da plataforma.</li>
                <li><strong>Imagens:</strong> as fotografias enviadas contam com o consentimento implícito ou explícito de quem aparece nelas, ou foram tiradas no âmbito de uma transação de adoção pública ou privada.</li>
                <li><strong>Responsabilidade Legal:</strong> o usuário é o único responsável legal pelo conteúdo que publicar. O BuenAdoptante não assume qualquer responsabilidade por reclamações de difamação, calúnia ou violação de direitos de terceiros decorrentes das publicações dos usuários.</li>
            </ul>

            <h2>3. Precisão das Informações</h2>
            <p>
                O BuenAdoptante atua como um repositório colaborativo e não verifica de forma independente a
                exatidão das informações publicadas pelos usuários. A plataforma não se responsabiliza pelas
                decisões de adoção tomadas com base no histórico ou na avaliação exibidos nos perfis.
            </p>

            <h2>4. Usos Proibidos</h2>
            <p>É estritamente proibido utilizar a plataforma para:</p>
            <ul>
                <li>Assediar, ameaçar, discriminar ou intimidar qualquer pessoa.</li>
                <li>Publicar informações falsas com o objetivo deliberado de prejudicar a reputação de terceiros.</li>
                <li>Utilizar os dados para fins comerciais, de marketing ou qualquer finalidade alheia ao bem-estar animal.</li>
                <li>Extração massiva de dados (scraping) por meio de processos automatizados.</li>
            </ul>

            <h2>5. Moderação e Remoção de Conteúdo</h2>
            <p>O BuenAdoptante se reserva o direito de modificar ou excluir conteúdo que:</p>
            <ul>
                <li>Infrinja estes termos.</li>
                <li>Seja denunciado como manifestamente falso ou mal-intencionado.</li>
                <li>Seja objeto de uma reclamação legítima por parte do titular dos dados no exercício de seus direitos de proteção de dados pessoais.</li>
            </ul>

            <h2 id="disputes">6. Disputas e Reclamações</h2>
            <p>
                Se você considerar que um perfil contém informações imprecisas ou afeta seus direitos fundamentais:
            </p>
            <ul>
                <li>Entre em contato com <strong>privacidad@buenadoptante.com</strong> detalhando o perfil e a informação em questão.</li>
                <li>A plataforma avaliará a solicitação conforme a evidência apresentada e os prazos estabelecidos pela norma local de proteção de dados.</li>
                <li>Em casos de falsidade evidente, procederá à remoção ou retificação imediata.</li>
            </ul>

            <h2>7. Limitação de Responsabilidade</h2>
            <p>
                O BuenAdoptante é um intermediário tecnológico. Na medida máxima permitida pela lei
                aplicável, a plataforma não será responsável por:
            </p>
            <ul>
                <li>Danos diretos ou indiretos decorrentes do uso das informações compartilhadas por outros usuários.</li>
                <li>Qualquer conflito legal entre resgatistas e adotantes.</li>
                <li>A veracidade dos depoimentos e das avaliações.</li>
            </ul>

            <h2>8. Propriedade Intelectual</h2>
            <p>
                Os usuários conservam a autoria de seus relatos e imagens, concedendo ao BuenAdoptante uma
                licença gratuita e não exclusiva para sua visualização e processamento dentro do serviço.
                O design, o software e as marcas do BuenAdoptante são propriedade exclusiva de seus desenvolvedores.
            </p>

            <h2>9. Modificações</h2>
            <p>
                A plataforma poderá atualizar estes termos a qualquer momento. O uso contínuo do
                serviço após a publicação de alterações constitui a aceitação dos novos termos.
            </p>

            <h2>10. Legislação Aplicável e Jurisdição</h2>
            <p>
                Estes termos regem-se pelos princípios gerais do direito e pelas leis de proteção
                de dados e bem-estar animal vigentes no país de residência do usuário. Para qualquer
                controvérsia, as partes concordam em submeter-se à jurisdição dos tribunais competentes
                no domicílio do titular da plataforma ou, na sua falta, onde tiver sido originado o
                registro dos dados.
            </p>
        </>
    );
}
