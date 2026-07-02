import type { CatalogSlice } from '../types';

// Strings specific to the animal-facing showcase surfaces: AnimalDetail (the
// per-animal page) and AnimalCard (one card in the grid). Shared chrome
// (loading, network error, not-found, generic CTA) lives in `common`.
//
// Species/sex helpers accept both Spanish (`perro`, `hembra`) and English
// (`dog`, `female`) source values and normalise to a canonical key before
// rendering, so the same key set serves either upstream vocabulary.
//
// pt values are pt-BR *register* (você, natural Brazilian phrasing); the
// CatalogSlice key is still `pt`.
export const animal: CatalogSlice = {
    es: {
        'animal.back_to_catalog': '← Volver al catálogo',
        'animal.no_longer_available': 'Este animal ya no está disponible',
        'animal.unnamed': 'Sin nombre',
        'animal.photo_position': 'Foto {n} de {total}',
        'animal.neutered': 'Castrado/a',
        'animal.about': 'Sobre {name}',
        'animal.posted_by': 'Publicado por',
        'animal.adopt_cta': 'Quiero adoptarlo',
        'animal.unavailable_for_application': 'Este animal no está disponible para postulación en este momento.',
        'animal.follow_instagram': 'Seguinos en Instagram',
        // Species
        'animal.species_dog': 'Perro',
        'animal.species_cat': 'Gato',
        'animal.species_bird': 'Ave',
        'animal.species_rabbit': 'Conejo',
        'animal.species_other': 'Otro',
        // Sex
        'animal.sex_male': 'Macho',
        'animal.sex_female': 'Hembra',
        // Age (singular/plural)
        'animal.age_month': '{n} mes',
        'animal.age_months': '{n} meses',
        'animal.age_year': '{n} año',
        'animal.age_years': '{n} años',
    },
    en: {
        'animal.back_to_catalog': '← Back to catalog',
        'animal.no_longer_available': 'This animal is no longer available',
        'animal.unnamed': 'Unnamed',
        'animal.photo_position': 'Photo {n} of {total}',
        'animal.neutered': 'Neutered',
        'animal.about': 'About {name}',
        'animal.posted_by': 'Posted by',
        'animal.adopt_cta': 'I want to adopt',
        'animal.unavailable_for_application': 'This animal is not available for applications right now.',
        'animal.follow_instagram': 'Follow us on Instagram',
        // Species
        'animal.species_dog': 'Dog',
        'animal.species_cat': 'Cat',
        'animal.species_bird': 'Bird',
        'animal.species_rabbit': 'Rabbit',
        'animal.species_other': 'Other',
        // Sex
        'animal.sex_male': 'Male',
        'animal.sex_female': 'Female',
        // Age (singular/plural)
        'animal.age_month': '{n} month',
        'animal.age_months': '{n} months',
        'animal.age_year': '{n} year',
        'animal.age_years': '{n} years',
    },
    pt: {
        'animal.back_to_catalog': '← Voltar ao catálogo',
        'animal.no_longer_available': 'Este animal não está mais disponível',
        'animal.unnamed': 'Sem nome',
        'animal.photo_position': 'Foto {n} de {total}',
        'animal.neutered': 'Castrado(a)',
        'animal.about': 'Sobre {name}',
        'animal.posted_by': 'Publicado por',
        'animal.adopt_cta': 'Quero adotá-lo',
        'animal.unavailable_for_application': 'Este animal não está disponível para candidatura no momento.',
        'animal.follow_instagram': 'Siga-nos no Instagram',
        // Species
        'animal.species_dog': 'Cão',
        'animal.species_cat': 'Gato',
        'animal.species_bird': 'Ave',
        'animal.species_rabbit': 'Coelho',
        'animal.species_other': 'Outro',
        // Sex
        'animal.sex_male': 'Macho',
        'animal.sex_female': 'Fêmea',
        // Age (singular/plural)
        'animal.age_month': '{n} mês',
        'animal.age_months': '{n} meses',
        'animal.age_year': '{n} ano',
        'animal.age_years': '{n} anos',
    },
};
