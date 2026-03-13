import './petshield.css'

export default function TermsPage() {
    return (
        <div className="ps-form" style={{ padding: 'var(--ps-4)' }}>
            <div className="ps-step-container" style={{ maxWidth: 640, textAlign: 'left' }}>
                <a
                    href="javascript:history.back()"
                    style={{
                        color: 'var(--ps-accent)',
                        fontSize: 14,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        marginBottom: 'var(--ps-4)',
                    }}
                >
                    ← Volver
                </a>

                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 'var(--ps-3)', color: 'var(--ps-text)' }}>
                    Términos y Condiciones
                </h1>

                <p style={{ fontSize: 13, color: 'var(--ps-text-muted)', marginBottom: 'var(--ps-4)' }}>
                    Última actualización: marzo 2026
                </p>

                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ps-text-secondary)' }}>
                    <Section title="1. Descripción del servicio">
                        <p>
                            Este formulario es parte de un sistema de gestión de adopciones responsables. Permite a los
                            rescatistas recopilar y verificar información de potenciales adoptantes con el fin de
                            garantizar el bienestar de los animales entregados en adopción.
                        </p>
                    </Section>

                    <Section title="2. Datos personales recopilados">
                        <p>Al completar este formulario, se te solicitará la siguiente información:</p>
                        <ul>
                            <li><strong>Nombre completo</strong> — para identificarte como adoptante.</li>
                            <li><strong>Email</strong> — para comunicaciones relacionadas con la adopción.</li>
                            <li><strong>Teléfono</strong> (opcional) — para contacto directo por parte del rescatista.</li>
                            <li><strong>Dirección</strong> — para verificar las condiciones del hogar.</li>
                            <li><strong>Geolocalización</strong> (opcional) — para confirmar tu ubicación actual.</li>
                            <li><strong>Fotografía</strong> (opcional) — para verificación de identidad.</li>
                        </ul>
                    </Section>

                    <Section title="3. Finalidad del tratamiento">
                        <p>Tus datos serán utilizados exclusivamente para:</p>
                        <ul>
                            <li>Evaluar tu solicitud de adopción.</li>
                            <li>Facilitar la comunicación entre vos y el rescatista.</li>
                            <li>Mantener un registro del proceso de adopción.</li>
                            <li>Proteger el bienestar del animal mediante la verificación del adoptante.</li>
                        </ul>
                        <p>
                            Tus datos <strong>no serán vendidos, cedidos ni utilizados con fines comerciales o publicitarios</strong>.
                        </p>
                    </Section>

                    <Section title="4. Destinatarios de los datos">
                        <p>
                            La información que proporciones será accesible únicamente por el <strong>rescatista que
                            generó el enlace</strong> de este formulario y los administradores del sistema de gestión.
                            No se compartirá con terceros salvo requerimiento legal.
                        </p>
                    </Section>

                    <Section title="5. Conservación de los datos">
                        <p>
                            Tus datos serán conservados mientras dure el proceso de adopción y, posteriormente,
                            como registro histórico con fines de protección animal. Podés solicitar su eliminación
                            en cualquier momento (ver sección 7).
                        </p>
                    </Section>

                    <Section title="6. Base legal">
                        <p>
                            El tratamiento de tus datos se realiza en cumplimiento de la{' '}
                            <strong>Ley 25.326 de Protección de Datos Personales</strong> de la República Argentina
                            y su Decreto Reglamentario 1558/2001. Tu consentimiento explícito al aceptar estos
                            términos constituye la base legal del tratamiento.
                        </p>
                    </Section>

                    <Section title="7. Tus derechos (ARCO)">
                        <p>Tenés derecho a:</p>
                        <ul>
                            <li><strong>Acceso</strong> — conocer qué datos tuyos están almacenados.</li>
                            <li><strong>Rectificación</strong> — corregir datos inexactos o incompletos.</li>
                            <li><strong>Cancelación</strong> — solicitar la eliminación de tus datos.</li>
                            <li><strong>Oposición</strong> — oponerte al tratamiento de tus datos.</li>
                        </ul>
                        <p>
                            Para ejercer cualquiera de estos derechos, escribí a{' '}
                            <strong>privacidad@buenadoptante.com</strong> indicando tu nombre completo
                            y la acción que solicitás. Responderemos dentro de los 10 días hábiles.
                        </p>
                    </Section>

                    <Section title="8. Seguridad">
                        <p>
                            Los datos se almacenan de forma segura utilizando protocolos de cifrado estándar.
                            Se implementan medidas técnicas y organizativas para proteger tu información
                            contra acceso no autorizado, pérdida o alteración.
                        </p>
                    </Section>

                    <Section title="9. Modificaciones">
                        <p>
                            Estos términos podrán ser modificados en cualquier momento. Las modificaciones
                            serán efectivas a partir de su publicación. El uso continuado del formulario
                            implica la aceptación de los términos vigentes.
                        </p>
                    </Section>

                    <Section title="10. Legislación aplicable">
                        <p>
                            Estos términos se rigen por las leyes de la <strong>República Argentina</strong>.
                            Para cualquier controversia serán competentes los tribunales ordinarios de la
                            Ciudad Autónoma de Buenos Aires.
                        </p>
                    </Section>
                </div>
            </div>
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 'var(--ps-4)' }}>
            <h2 style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--ps-text)',
                marginBottom: 'var(--ps-2)',
            }}>
                {title}
            </h2>
            {children}
        </div>
    )
}
