import { config, fields, collection, singleton } from '@keystatic/core';

export default config({
    storage: {
        kind: 'local',
    },
    collections: {
        'guia-steps': collection({
            label: 'Guide Steps / Pasos de la Guía',
            slugField: 'title',
            path: 'content/guia-steps/*/',
            format: { contentField: 'content' },
            schema: {
                title: fields.slug({ name: { label: 'Title (identifier)' } }),
                titleEs: fields.text({ label: 'Título (Español)', validation: { isRequired: true } }),
                titleEn: fields.text({ label: 'Title (English)', validation: { isRequired: true } }),
                descriptionEs: fields.text({ label: 'Descripción (Español)', multiline: true }),
                descriptionEn: fields.text({ label: 'Description (English)', multiline: true }),
                icon: fields.text({ label: 'Icon (emoji)', defaultValue: '📋' }),
                order: fields.integer({ label: 'Order', defaultValue: 0, validation: { isRequired: true } }),
                details: fields.array(
                    fields.object({
                        textEs: fields.text({ label: 'Detalle (Español)', multiline: true, validation: { isRequired: true } }),
                        textEn: fields.text({ label: 'Detail (English)', multiline: true, validation: { isRequired: true } }),
                        linkUrl: fields.text({ label: 'Link URL (optional)', description: 'Internal link for this item, e.g. "/" for search' }),
                        linkTextEs: fields.text({ label: 'Link Text (Español)', description: 'Visible text for the link in Spanish' }),
                        linkTextEn: fields.text({ label: 'Link Text (English)', description: 'Visible text for the link in English' }),
                    }),
                    {
                        label: 'Detail Bullets / Detalles',
                        itemLabel: (props) => props.fields.textEs.value?.slice(0, 60) || 'New detail',
                    }
                ),
                content: fields.markdoc({ label: 'Extended Content (Español)' }),
            },
        }),
        'guia-faq': collection({
            label: 'Guide FAQ / Preguntas Frecuentes',
            slugField: 'question',
            path: 'content/guia-faq/*/',
            format: { contentField: 'answerEs' },
            schema: {
                question: fields.slug({ name: { label: 'Question ID' } }),
                questionEs: fields.text({ label: 'Pregunta (Español)', validation: { isRequired: true } }),
                questionEn: fields.text({ label: 'Question (English)', validation: { isRequired: true } }),
                answerEs: fields.markdoc({ label: 'Respuesta (Español)' }),
                answerEn: fields.text({ label: 'Answer (English)', multiline: true }),
                order: fields.integer({ label: 'Order', defaultValue: 0 }),
            },
        }),
    },
    singletons: {
        'guia-hero': singleton({
            label: 'Guide Hero / Héroe de la Guía',
            path: 'content/guia-hero/',
            format: { data: 'json' },
            schema: {
                titleEs: fields.text({ label: 'Título (Español)', validation: { isRequired: true } }),
                titleEn: fields.text({ label: 'Title (English)', validation: { isRequired: true } }),
                subtitleEs: fields.text({ label: 'Subtítulo (Español)', multiline: true }),
                subtitleEn: fields.text({ label: 'Subtitle (English)', multiline: true }),
                ctaTextEs: fields.text({ label: 'Texto del Botón CTA (Español)', defaultValue: 'Empezar a verificar' }),
                ctaTextEn: fields.text({ label: 'CTA Button Text (English)', defaultValue: 'Start vetting' }),
                ctaUrl: fields.text({ label: 'CTA URL', defaultValue: '/' }),
            },
        }),
        'adoption-contract': singleton({
            label: 'Adoption Contract / Contrato de Adopción',
            path: 'content/adoption-contract/',
            format: { data: 'json' },
            schema: {
                titleEs: fields.text({ label: 'Título del contrato (Español)', defaultValue: 'CONTRATO DE ADOPCIÓN RESPONSABLE DE ANIMAL DE COMPAÑÍA' }),
                titleEn: fields.text({ label: 'Contract title (English)', defaultValue: 'RESPONSIBLE PET ADOPTION CONTRACT' }),
                introEs: fields.text({ label: 'Introducción (Español)', multiline: true, defaultValue: 'Se celebra el presente contrato entre las partes indicadas a continuación.' }),
                introEn: fields.text({ label: 'Introduction (English)', multiline: true, defaultValue: 'This contract is entered into between the parties indicated below.' }),
                bodyEs: fields.text({ label: 'Cuerpo del contrato (Español)', multiline: true }),
                bodyEn: fields.text({ label: 'Contract body (English)', multiline: true }),
            },
        }),
    },
});
