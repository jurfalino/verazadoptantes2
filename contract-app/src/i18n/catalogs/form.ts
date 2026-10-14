import type { CatalogSlice } from '../types';

// PetShieldForm intake form: step nav, the DEFAULT_SCHEMA question set,
// validation messages, and toasts. `es` is the authoritative original text;
// `en`/`pt` are translations (pt-BR uses `você` forms, never voseo).
//
// NOTE: registering this slice in ../index.ts (the SLICES array) is what makes
// these keys resolve. Until it's added there, every key falls through to the
// raw key string.
export const form: CatalogSlice = {
    es: {
        // ── New questions (spec 2026-10-14, release 1) ──
        'form.q_carer_title': '¿Quién lo va a cuidar día a día?',
        'form.opt_carer_me': 'Yo',
        'form.opt_carer_otherAdult': 'Otro adulto de la casa',
        'form.opt_carer_minor': 'Un menor',
        'form.q_allergy_title': '¿Alguien en la casa tiene alergia a los animales?',
        'form.q_allergy_title_gift': '¿Alguien en la casa de {n} tiene alergia a los animales?',
        'form.q_petsCare_title': '¿Están castrados y vacunados?',
        'form.opt_some': 'Algunos',
        'form.q_rental_title': '¿La casa es tuya o alquilás?',
        'form.q_rental_title_gift': '¿La casa de {n} es propia o alquilada?',
        'form.opt_rental_own': 'Es propia',
        'form.opt_rental_rentAllowed': 'Alquilo y permiten animales',
        'form.opt_rental_rentNotAllowed': 'Alquilo y no permiten',
        'form.opt_rental_rentUnsure': 'Alquilo, no sé si permiten',
        'form.q_catOutdoor_title': '¿Saldría a la calle o a los techos?',
        'form.q_catOutdoor_title_gift': 'En lo de {n}, ¿saldría a la calle o a los techos?',
        'form.opt_sometimes': 'A veces',
        'form.q_sleepPlace_title': '¿Dónde va a dormir?',
        'form.q_sleepPlace_title_gift': '¿Dónde va a dormir en lo de {n}?',
        'form.opt_sleep_inside': 'Adentro',
        'form.opt_sleep_outside': 'Afuera',
        'form.q_dogWalks_title': '¿Cuántas veces por día lo sacarían a pasear?',
        'form.q_dogWalks_title_gift': 'En lo de {n}, ¿cuántas veces por día lo sacarían a pasear?',
        'form.opt_walks_twicePlus': '2 veces o más',
        'form.opt_walks_once': '1 vez',
        'form.opt_walks_walker': 'Lo pasea un paseador',
        'form.opt_walks_none': 'No sale, tiene patio',
        'form.q_dogTied_title': '¿Va a estar atado, o solo en un patio o terraza?',
        'form.q_dogTied_title_gift': 'En lo de {n}, ¿va a estar atado, o solo en un patio o terraza?',
        'form.q_lastAnimal_title': '¿Qué pasó con tu último animal?',
        'form.q_lastAnimal_title_gift': '¿Qué pasó con el último animal de {n}?',
        'form.opt_last_withMe': 'Sigue conmigo',
        'form.opt_last_oldAge': 'Murió de viejo o enfermo',
        'form.opt_last_lost': 'Se perdió o escapó',
        'form.opt_last_street': 'Murió en la calle (atropellado, envenenado)',
        'form.opt_last_gave': 'Lo di o lo regalé',
        'form.opt_last_first': 'Es mi primera vez',
        'form.q_gaveAway_title': '¿Alguna vez diste o regalaste un animal?',
        'form.q_gaveAway_title_gift': '¿{n} alguna vez dio o regaló un animal?',
        'form.gaveAway_why': '¿Por qué?',
        'form.q_sterilizeHow_title': '¿Cómo lo castrarías?',
        'form.q_sterilizeHow_title_gift': '¿Cómo lo castrarían?',
        'form.opt_sterilize_done': 'Ya está castrado',
        'form.opt_sterilize_vet': 'Con mi veterinario',
        'form.opt_sterilize_campaign': 'En una campaña gratuita',
        'form.q_movingIfNoPets_title': 'Si te mudás y no aceptan animales, ¿qué harías?',
        'form.q_movingIfNoPets_title_gift': 'Si {n} se muda y no aceptan animales, ¿qué haría?',
        'form.opt_moving_find': 'Busco otro lugar que acepte',
        'form.opt_moving_family': 'Lo dejo con un familiar',
        'form.opt_moving_return': 'Lo devuelvo o lo doy',
        'form.q_returnReasons_title': '¿Hay algo por lo que lo devolverías?',
        'form.opt_return_no': 'No',
        'form.opt_return_allergy': 'Alergia',
        'form.opt_return_baby': 'Un bebé',
        'form.opt_return_behaviour': 'Problemas de conducta',
        'form.opt_return_other': 'Otro',
        'form.q_adaptPlan_title': 'Si rompe cosas, se hace encima o no se lleva con tu otra mascota…',
        'form.opt_adapt_patience': 'Le tengo paciencia o busco un educador',
        'form.opt_adapt_askRescue': 'Pido ayuda al refugio',
        'form.opt_adapt_return': 'Lo devuelvo',
        'form.q_visitConsent_title': '¿Aceptás una visita o videollamada para conocer dónde va a vivir, y que te contactemos después para saber cómo está?',
        'form.opt_visit_videoOnly': 'Solo videollamada',
        'form.q_social_title': '¿Tenés Instagram o Facebook?',
        'form.q_social_subtitle': 'Nos ayuda a conocerte y a saber de él después. Es opcional.',
        'form.field_instagram': 'Instagram',
        'form.field_facebook': 'Facebook',
        'form.field_social_placeholder': '@usuario',
        'form.q_vetReference_title': '¿Tenés veterinario?',
        'form.field_vetReference': 'Nombre o teléfono (opcional)',
        'form.q_motivation_title': 'Contanos un poco más',
        'form.field_motivation': '¿Por qué querés adoptar?',
        'form.field_howHeard': '¿Cómo nos conociste?',
        // ── Gift flow (spec Part 2) ──
        'form.q_gift_recipient_title': '¿Para quién es?',
        'form.q_gift_recipient_subtitle': 'La persona que va a vivir con el animal',
        'form.gift_first_name': 'Nombre',
        'form.gift_phone': 'Teléfono (opcional)',
        'form.err_gift_recipient': 'Elegí la relación y escribí su nombre.',
        'form.err_gift_phone': 'Revisá su teléfono: solo números, espacios y + ( ) -.',
        'form.opt_unknown': 'No sé',
        'form.q_children_title_gift': '¿Hay niños en la casa de {n}?',
        'form.q_existing_pets_title_gift': '¿{n} tiene mascotas actualmente?',
        'form.q_housing_title_gift': '¿Dónde vive {n}?',
        'form.q_outdoor_title_gift': '¿{n} tiene patio o jardín?',
        'form.q_pet_experience_title_gift': '¿{n} tuvo mascotas antes?',
        'form.q_sterilize_title_gift': '¿{n} acepta castrar o esterilizar al animal?',
        'form.q_moving_title_gift': '¿{n} tiene pensado mudarse pronto?',
        'form.q_vacation_title_gift': '¿Qué haría {n} con el animal en vacaciones?',
        'form.q_household_title_gift': '¿Quiénes viven con {n}?',
        'form.q_household_subtitle_gift': 'Sin contar a {n}',
        'form.household_alone_gift': 'No vive con nadie',
        // ── Household people (spec 2026-10-04) ──
        'form.q_household_title_house': '¿Quiénes viven en la casa?',
        'form.q_household_title_apartment': '¿Quiénes viven en el departamento?',
        'form.q_household_title_home': '¿Quiénes viven en tu hogar?',
        'form.q_household_subtitle': 'Sin contarte a vos',
        'form.household_alone': 'Vivo solo/a',
        'form.household_add': 'Agregar persona',
        'form.household_relationship': 'Relación',
        'form.household_age': 'Edad',
        'form.household_first_name': 'Nombre (opcional)',
        'form.household_last_name': 'Apellido (opcional)',
        'form.household_save': 'Guardar',
        'form.household_cancel': 'Cancelar',
        'form.household_edit': 'Editar',
        'form.household_remove': 'Quitar',
        'form.household_years': '{n} años',
        'form.err_household': 'Agregá a las personas que viven con vos o elegí «Vivo solo/a».',
        'form.rel_partner': 'Pareja',
        'form.rel_child': 'Hijo/a',
        'form.rel_parent': 'Padre/Madre',
        'form.rel_sibling': 'Hermano/a',
        'form.rel_other_relative': 'Otro familiar',
        'form.rel_housemate': 'Amigo/a o compañero/a',
        // ── Step navigation ──
        'form.step_of': 'Paso {n} de {total}',
        'form.continue': 'Continuar →',
        'form.back': '← Atrás',
        'form.submit': 'Enviar',
        'form.submitting': 'Enviando...',

        // ── Consent (legal) ──
        'form.legal_title': 'Solicitud de adopción',
        'form.legal_body': 'Completá este breve formulario para registrar tu interés en adoptar. Nos ayuda a encontrar el animal ideal según lo que buscás. El rescatista revisará tu solicitud para ponerse en contacto.',
        'form.consent_accept_prefix': 'Acepto los',
        'form.consent_terms_link': 'Términos y Condiciones',
        'form.consent_conforms': 'Conforme a {ref}',

        // ── Shared answers ──
        'form.opt_yes': 'Sí',
        'form.opt_no': 'No',
        'form.opt_other': 'Otro',

        // ── Species ──
        'form.q_species_title': '¿Qué animal buscás?',
        'form.opt_dog': 'Perro',
        'form.opt_cat': 'Gato',

        // ── Life stage ──
        'form.q_lifestage_title': '¿Qué edad preferís?',
        'form.opt_puppy': 'Cachorro',
        'form.opt_young': 'Joven',
        'form.opt_senior': 'Senior',
        'form.opt_no_preference': 'Sin preferencia',

        // ── Special needs ──
        'form.q_special_needs_label': 'Abierto a necesidades especiales',
        'form.q_special_needs_desc': 'Ej: gatos con ERC, animales con discapacidad o cuidado crónico.',

        // ── Intent ──
        'form.q_intent_title': '¿Es para vos o es un regalo?',
        'form.opt_intent_self': 'Para mí',
        'form.opt_intent_gift': 'Es un regalo',

        // ── Children ──
        'form.q_children_title': '¿Hay niños en el hogar?',

        // ── Existing pets ──
        'form.q_existing_pets_title': '¿Tenés mascotas actualmente?',
        'form.q_existing_pets_subtitle': 'Tocá cada ícono para sumar una mascota de ese tipo',
        'form.opt_dogs': 'Perros',
        'form.opt_cats': 'Gatos',
        'form.opt_birds': 'Pájaros',

        // ── Housing type ──
        'form.q_housing_title': '¿Dónde vivís?',
        'form.opt_house': 'Casa',
        'form.opt_apartment': 'Departamento',

        // ── Outdoor space ──
        'form.q_outdoor_title': '¿Tenés patio o jardín?',

        // ── Is safe ──
        'form.q_is_safe_title': '¿El espacio está protegido?',
        'form.opt_safe_yes': 'Sí, está cerrado',
        'form.opt_safe_no': 'No está cerrado',
        'form.opt_na': 'No aplica',

        // ── Hours alone ──
        'form.q_hours_alone_title': '¿Cuántas horas al día estaría solo el animal?',

        // ── Pet experience ──
        'form.q_pet_experience_title': '¿Tuviste mascotas antes?',
        'form.opt_exp_none': 'No, primera vez',
        'form.opt_exp_cat': 'Sí, gato',
        'form.opt_exp_dog': 'Sí, perro',
        'form.opt_exp_other': 'Sí, otro',

        // ── Willing to sterilize ──
        'form.q_sterilize_title': '¿Estás dispuesto/a a castrar o esterilizar?',

        // ── Vet commitment ──
        'form.q_vet_label': 'Me comprometo a llevar al animal al veterinario',
        'form.q_vet_desc': 'Vacunación, controles y atención cuando sea necesario',

        // ── Moving plans ──
        'form.q_moving_title': '¿Tenés pensado mudarte pronto?',
        'form.opt_moving_maybe': 'Posiblemente',

        // ── Vacation plan ──
        'form.q_vacation_title': '¿Qué harías con el animal en vacaciones?',
        'form.opt_vac_take': 'Lo llevo conmigo',
        'form.opt_vac_family': 'Lo cuida familia',
        'form.opt_vac_sitter': 'Cuidador / guardería',
        'form.opt_vac_unsure': 'No lo sé aún',

        // ── Identity: name ──
        'form.q_name_title': '¿Cómo te llamás?',
        'form.field_name_label': 'Nombre completo',
        'form.field_name_placeholder': 'Juan García',

        // ── Identity: email ──
        'form.q_email_title': '¿Cuál es tu email?',
        'form.field_email_label': 'Email',
        'form.field_email_placeholder': 'juan@ejemplo.com',

        // ── Identity: phone ──
        'form.q_phone_title': '¿Tu teléfono?',
        'form.field_phone_label': 'Teléfono',
        'form.field_phone_placeholder': 'Código de país + número',

        // ── Identity: address ──
        'form.q_address_title': '¿Dónde vivís?',
        'form.field_address_label': 'Dirección',
        'form.field_address_placeholder': 'Calle, número, ciudad, país',

        // ── Age range ──
        'form.q_age_title': '¿Qué edad tenés?',

        // ── Geolocation ──
        'form.q_geo_question': '¿Estás actualmente en tu domicilio?',
        'form.geo_yes': 'Sí, estoy en mi casa',
        'form.geo_subtitle': 'Esto nos ayuda a verificar tu ubicación. Es opcional.',
        'form.geo_obtained': 'Ubicación obtenida',

        // ── Selfie / camera-upload ──
        'form.q_selfie_title': 'Verificación de identidad',
        'form.q_selfie_instructions': 'Tomá una selfie o subí una foto tuya para verificar tu identidad.',
        'form.selfie_alt': 'Selfie',
        'form.change_photo': 'Cambiar foto',
        'form.take_selfie': '📸 Tomar Selfie',
        'form.gallery_pick': 'O elegí una foto de tu galería',
        'form.file_hint': 'JPG, PNG — máx 5MB',
        'form.selfie_optional': 'Este paso es opcional — podés continuar sin foto',

        // ── Pet counter ──
        'form.counter_subtract': '− Restar',
        'form.counter_none': 'Si no tenés mascotas, continuá al siguiente paso',

        // ── Keyboard hint ──
        'form.kbd_hint_prefix': 'Presioná',
        'form.kbd_hint_suffix': 'para continuar',

        // ── Validation ──
        'form.err_must_accept': 'Debés aceptar para continuar',
        'form.err_required': 'Campo obligatorio',
        'form.err_email': 'Email inválido',
        'form.err_format': 'Formato inválido',
        'form.err_select_option': 'Seleccioná una opción',

        // ── Toasts / errors ──
        'form.err_invalid_link_user': 'Error: enlace inválido — falta ID de usuario',
        'form.err_unknown': 'Error desconocido',
        'form.err_submit': 'Error al enviar',
        'form.err_network': 'Error de red. Verificá tu conexión e intentá de nuevo.',
        'form.err_geo': 'No se pudo obtener la ubicación. Podés continuar sin ella.',
        'form.err_images_only': 'Solo se permiten imágenes.',
        'form.err_selfie_read': 'No pudimos leer esa foto. Probá con otra o sacala de nuevo.',
        'form.err_selfie_not_saved': 'Tu formulario se envió, pero la foto no se pudo guardar. Si te la piden, mandala por otro medio.',

        // ── Completion / invalid-link screens ──
        'form.complete_title': '¡Listo!',
        'form.complete_desc': 'Tu solicitud fue enviada exitosamente. El rescatista recibirá tu información y se pondrá en contacto pronto.',
        'form.invalid_link_title': 'Enlace inválido',
        'form.invalid_link_desc': 'Este formulario necesita un enlace válido. Pedí uno nuevo al rescatista.',
    },
    en: {
        // ── New questions (spec 2026-10-14, release 1) ──
        'form.q_carer_title': 'Who will look after it day to day?',
        'form.opt_carer_me': 'Me',
        'form.opt_carer_otherAdult': 'Another adult at home',
        'form.opt_carer_minor': 'A minor',
        'form.q_allergy_title': 'Is anyone at home allergic to animals?',
        'form.q_allergy_title_gift': "Is anyone in {n}'s home allergic to animals?",
        'form.q_petsCare_title': 'Are they neutered and vaccinated?',
        'form.opt_some': 'Some',
        'form.q_rental_title': 'Do you own your home or rent?',
        'form.q_rental_title_gift': 'Does {n} own or rent their home?',
        'form.opt_rental_own': 'I own it',
        'form.opt_rental_rentAllowed': 'I rent and animals are allowed',
        'form.opt_rental_rentNotAllowed': "I rent and they're not allowed",
        'form.opt_rental_rentUnsure': 'I rent, not sure if allowed',
        'form.q_catOutdoor_title': 'Would it go out to the street or roofs?',
        'form.q_catOutdoor_title_gift': "At {n}'s, would it go out to the street or roofs?",
        'form.opt_sometimes': 'Sometimes',
        'form.q_sleepPlace_title': 'Where will it sleep?',
        'form.q_sleepPlace_title_gift': "Where will it sleep at {n}'s?",
        'form.opt_sleep_inside': 'Indoors',
        'form.opt_sleep_outside': 'Outdoors',
        'form.q_dogWalks_title': 'How many times a day would it be walked?',
        'form.q_dogWalks_title_gift': "At {n}'s, how many times a day would it be walked?",
        'form.opt_walks_twicePlus': 'Twice or more',
        'form.opt_walks_once': 'Once',
        'form.opt_walks_walker': 'A dog walker',
        'form.opt_walks_none': "It doesn't go out, there's a yard",
        'form.q_dogTied_title': 'Will it be tied up, or alone in a yard or terrace?',
        'form.q_dogTied_title_gift': "At {n}'s, will it be tied up, or alone in a yard or terrace?",
        'form.q_lastAnimal_title': 'What happened to your last animal?',
        'form.q_lastAnimal_title_gift': "What happened to {n}'s last animal?",
        'form.opt_last_withMe': 'Still with me',
        'form.opt_last_oldAge': 'Died of old age or illness',
        'form.opt_last_lost': 'Got lost or ran away',
        'form.opt_last_street': 'Died outside (hit by a car, poisoned)',
        'form.opt_last_gave': 'I gave it away',
        'form.opt_last_first': 'This is my first',
        'form.q_gaveAway_title': 'Have you ever given an animal away?',
        'form.q_gaveAway_title_gift': 'Has {n} ever given an animal away?',
        'form.gaveAway_why': 'Why?',
        'form.q_sterilizeHow_title': 'How would you have it neutered?',
        'form.q_sterilizeHow_title_gift': 'How would they have it neutered?',
        'form.opt_sterilize_done': "It's already neutered",
        'form.opt_sterilize_vet': 'With my vet',
        'form.opt_sterilize_campaign': 'At a free campaign',
        'form.q_movingIfNoPets_title': "If you move and animals aren't allowed, what would you do?",
        'form.q_movingIfNoPets_title_gift': "If {n} moves and animals aren't allowed, what would happen?",
        'form.opt_moving_find': 'Find a place that allows them',
        'form.opt_moving_family': 'Leave it with a relative',
        'form.opt_moving_return': 'Return it or give it away',
        'form.q_returnReasons_title': 'Is there anything that would make you return it?',
        'form.opt_return_no': 'No',
        'form.opt_return_allergy': 'Allergy',
        'form.opt_return_baby': 'A baby',
        'form.opt_return_behaviour': 'Behaviour problems',
        'form.opt_return_other': 'Something else',
        'form.q_adaptPlan_title': "If it breaks things, has accidents or doesn't get along with your other pet…",
        'form.opt_adapt_patience': "I'm patient or find a trainer",
        'form.opt_adapt_askRescue': 'I ask the rescue for help',
        'form.opt_adapt_return': 'I return it',
        'form.q_visitConsent_title': "Do you accept a visit or video call to see where it will live, and being contacted afterwards to hear how it's doing?",
        'form.opt_visit_videoOnly': 'Video call only',
        'form.q_social_title': 'Do you have Instagram or Facebook?',
        'form.q_social_subtitle': "It helps us get to know you and hear how it's doing later. Optional.",
        'form.field_instagram': 'Instagram',
        'form.field_facebook': 'Facebook',
        'form.field_social_placeholder': '@username',
        'form.q_vetReference_title': 'Do you have a vet?',
        'form.field_vetReference': 'Name or phone (optional)',
        'form.q_motivation_title': 'Tell us a bit more',
        'form.field_motivation': 'Why do you want to adopt?',
        'form.field_howHeard': 'How did you hear about us?',
        // ── Gift flow (spec Part 2) ──
        'form.q_gift_recipient_title': 'Who is it for?',
        'form.q_gift_recipient_subtitle': 'The person who will live with the animal',
        'form.gift_first_name': 'First name',
        'form.gift_phone': 'Phone (optional)',
        'form.err_gift_recipient': 'Choose the relationship and enter their name.',
        'form.err_gift_phone': 'Check their phone: numbers, spaces and + ( ) - only.',
        'form.opt_unknown': "I don't know",
        'form.q_children_title_gift': "Are there children in {n}'s home?",
        'form.q_existing_pets_title_gift': 'Does {n} currently have pets?',
        'form.q_housing_title_gift': 'Where does {n} live?',
        'form.q_outdoor_title_gift': 'Does {n} have a yard or garden?',
        'form.q_pet_experience_title_gift': 'Has {n} had pets before?',
        'form.q_sterilize_title_gift': 'Is {n} willing to spay or neuter?',
        'form.q_moving_title_gift': 'Is {n} planning to move soon?',
        'form.q_vacation_title_gift': 'What would {n} do with the animal on holidays?',
        'form.q_household_title_gift': 'Who lives with {n}?',
        'form.q_household_subtitle_gift': 'Not counting {n}',
        'form.household_alone_gift': 'Lives alone',
        // ── Household people (spec 2026-10-04) ──
        'form.q_household_title_house': 'Who lives in the house?',
        'form.q_household_title_apartment': 'Who lives in the apartment?',
        'form.q_household_title_home': 'Who lives in your home?',
        'form.q_household_subtitle': 'Not counting you',
        'form.household_alone': 'I live alone',
        'form.household_add': 'Add person',
        'form.household_relationship': 'Relationship',
        'form.household_age': 'Age',
        'form.household_first_name': 'First name (optional)',
        'form.household_last_name': 'Last name (optional)',
        'form.household_save': 'Save',
        'form.household_cancel': 'Cancel',
        'form.household_edit': 'Edit',
        'form.household_remove': 'Remove',
        'form.household_years': '{n} years old',
        'form.err_household': 'Add the people who live with you or choose “I live alone”.',
        'form.rel_partner': 'Partner',
        'form.rel_child': 'Son/Daughter',
        'form.rel_parent': 'Father/Mother',
        'form.rel_sibling': 'Brother/Sister',
        'form.rel_other_relative': 'Other relative',
        'form.rel_housemate': 'Friend or roommate',
        // ── Step navigation ──
        'form.step_of': 'Step {n} of {total}',
        'form.continue': 'Continue →',
        'form.back': '← Back',
        'form.submit': 'Submit',
        'form.submitting': 'Sending...',

        // ── Consent (legal) ──
        'form.legal_title': 'Adoption request',
        'form.legal_body': 'Fill out this short form to register your interest in adopting. It helps us find the right animal for what you’re looking for. The rescuer will review your request to get in touch.',
        'form.consent_accept_prefix': 'I accept the',
        'form.consent_terms_link': 'Terms and Conditions',
        'form.consent_conforms': 'In accordance with {ref}',

        // ── Shared answers ──
        'form.opt_yes': 'Yes',
        'form.opt_no': 'No',
        'form.opt_other': 'Other',

        // ── Species ──
        'form.q_species_title': 'What animal are you looking for?',
        'form.opt_dog': 'Dog',
        'form.opt_cat': 'Cat',

        // ── Life stage ──
        'form.q_lifestage_title': 'What age do you prefer?',
        'form.opt_puppy': 'Puppy',
        'form.opt_young': 'Young',
        'form.opt_senior': 'Senior',
        'form.opt_no_preference': 'No preference',

        // ── Special needs ──
        'form.q_special_needs_label': 'Open to special needs',
        'form.q_special_needs_desc': 'E.g. cats with CKD, animals with a disability or chronic care.',

        // ── Intent ──
        'form.q_intent_title': 'Is it for you or is it a gift?',
        'form.opt_intent_self': 'For me',
        'form.opt_intent_gift': 'It’s a gift',

        // ── Children ──
        'form.q_children_title': 'Are there children in the home?',

        // ── Existing pets ──
        'form.q_existing_pets_title': 'Do you currently have pets?',
        'form.q_existing_pets_subtitle': 'Tap each icon to add a pet of that type',
        'form.opt_dogs': 'Dogs',
        'form.opt_cats': 'Cats',
        'form.opt_birds': 'Birds',

        // ── Housing type ──
        'form.q_housing_title': 'Where do you live?',
        'form.opt_house': 'House',
        'form.opt_apartment': 'Apartment',

        // ── Outdoor space ──
        'form.q_outdoor_title': 'Do you have a yard or garden?',

        // ── Is safe ──
        'form.q_is_safe_title': 'Is the space secure?',
        'form.opt_safe_yes': 'Yes, it’s enclosed',
        'form.opt_safe_no': 'It’s not enclosed',
        'form.opt_na': 'Not applicable',

        // ── Hours alone ──
        'form.q_hours_alone_title': 'How many hours a day would the animal be alone?',

        // ── Pet experience ──
        'form.q_pet_experience_title': 'Have you had pets before?',
        'form.opt_exp_none': 'No, first time',
        'form.opt_exp_cat': 'Yes, a cat',
        'form.opt_exp_dog': 'Yes, a dog',
        'form.opt_exp_other': 'Yes, another',

        // ── Willing to sterilize ──
        'form.q_sterilize_title': 'Are you willing to spay or neuter?',

        // ── Vet commitment ──
        'form.q_vet_label': 'I commit to taking the animal to the vet',
        'form.q_vet_desc': 'Vaccinations, check-ups and care when needed',

        // ── Moving plans ──
        'form.q_moving_title': 'Are you planning to move soon?',
        'form.opt_moving_maybe': 'Possibly',

        // ── Vacation plan ──
        'form.q_vacation_title': 'What would you do with the animal on vacation?',
        'form.opt_vac_take': 'I take it with me',
        'form.opt_vac_family': 'Family cares for it',
        'form.opt_vac_sitter': 'Sitter / boarding',
        'form.opt_vac_unsure': 'I don’t know yet',

        // ── Identity: name ──
        'form.q_name_title': 'What’s your name?',
        'form.field_name_label': 'Full name',
        'form.field_name_placeholder': 'John Smith',

        // ── Identity: email ──
        'form.q_email_title': 'What’s your email?',
        'form.field_email_label': 'Email',
        'form.field_email_placeholder': 'john@example.com',

        // ── Identity: phone ──
        'form.q_phone_title': 'Your phone?',
        'form.field_phone_label': 'Phone',
        'form.field_phone_placeholder': 'Country code + number',

        // ── Identity: address ──
        'form.q_address_title': 'Where do you live?',
        'form.field_address_label': 'Address',
        'form.field_address_placeholder': 'Street, number, city, country',

        // ── Age range ──
        'form.q_age_title': 'How old are you?',

        // ── Geolocation ──
        'form.q_geo_question': 'Are you currently at your home?',
        'form.geo_yes': 'Yes, I’m at home',
        'form.geo_subtitle': 'This helps us verify your location. It’s optional.',
        'form.geo_obtained': 'Location obtained',

        // ── Selfie / camera-upload ──
        'form.q_selfie_title': 'Identity verification',
        'form.q_selfie_instructions': 'Take a selfie or upload a photo of yourself to verify your identity.',
        'form.selfie_alt': 'Selfie',
        'form.change_photo': 'Change photo',
        'form.take_selfie': '📸 Take selfie',
        'form.gallery_pick': 'Or choose a photo from your gallery',
        'form.file_hint': 'JPG, PNG — max 5MB',
        'form.selfie_optional': 'This step is optional — you can continue without a photo',

        // ── Pet counter ──
        'form.counter_subtract': '− Subtract',
        'form.counter_none': 'If you don’t have pets, continue to the next step',

        // ── Keyboard hint ──
        'form.kbd_hint_prefix': 'Press',
        'form.kbd_hint_suffix': 'to continue',

        // ── Validation ──
        'form.err_must_accept': 'You must accept to continue',
        'form.err_required': 'Required field',
        'form.err_email': 'Invalid email',
        'form.err_format': 'Invalid format',
        'form.err_select_option': 'Select an option',

        // ── Toasts / errors ──
        'form.err_invalid_link_user': 'Error: invalid link — missing user ID',
        'form.err_unknown': 'Unknown error',
        'form.err_submit': 'Failed to send',
        'form.err_network': 'Network error. Check your connection and try again.',
        'form.err_geo': 'Location could not be obtained. You can continue without it.',
        'form.err_images_only': 'Only images are allowed.',
        'form.err_selfie_read': 'We couldn\'t read that photo. Try another one or take it again.',
        'form.err_selfie_not_saved': 'Your form was sent, but the photo couldn\'t be saved. If they ask for it, send it another way.',

        // ── Completion / invalid-link screens ──
        'form.complete_title': 'Done!',
        'form.complete_desc': 'Your request was sent successfully. The rescuer will receive your information and get in touch soon.',
        'form.invalid_link_title': 'Invalid link',
        'form.invalid_link_desc': 'This form needs a valid link. Ask the rescuer for a new one.',
    },
    pt: {
        // ── New questions (spec 2026-10-14, release 1) ──
        'form.q_carer_title': 'Quem vai cuidar dele no dia a dia?',
        'form.opt_carer_me': 'Eu',
        'form.opt_carer_otherAdult': 'Outro adulto da casa',
        'form.opt_carer_minor': 'Um menor',
        'form.q_allergy_title': 'Alguém na casa tem alergia a animais?',
        'form.q_allergy_title_gift': 'Alguém na casa de {n} tem alergia a animais?',
        'form.q_petsCare_title': 'Eles são castrados e vacinados?',
        'form.opt_some': 'Alguns',
        'form.q_rental_title': 'A casa é sua ou você aluga?',
        'form.q_rental_title_gift': 'A casa de {n} é própria ou alugada?',
        'form.opt_rental_own': 'É própria',
        'form.opt_rental_rentAllowed': 'Alugo e permitem animais',
        'form.opt_rental_rentNotAllowed': 'Alugo e não permitem',
        'form.opt_rental_rentUnsure': 'Alugo, não sei se permitem',
        'form.q_catOutdoor_title': 'Ele sairia para a rua ou telhados?',
        'form.q_catOutdoor_title_gift': 'Na casa de {n}, ele sairia para a rua ou telhados?',
        'form.opt_sometimes': 'Às vezes',
        'form.q_sleepPlace_title': 'Onde ele vai dormir?',
        'form.q_sleepPlace_title_gift': 'Onde ele vai dormir na casa de {n}?',
        'form.opt_sleep_inside': 'Dentro de casa',
        'form.opt_sleep_outside': 'Fora de casa',
        'form.q_dogWalks_title': 'Quantas vezes por dia ele seria levado para passear?',
        'form.q_dogWalks_title_gift': 'Na casa de {n}, quantas vezes por dia ele seria levado para passear?',
        'form.opt_walks_twicePlus': '2 vezes ou mais',
        'form.opt_walks_once': '1 vez',
        'form.opt_walks_walker': 'Um passeador',
        'form.opt_walks_none': 'Não sai, tem quintal',
        'form.q_dogTied_title': 'Ele vai ficar amarrado, ou sozinho num quintal ou terraço?',
        'form.q_dogTied_title_gift': 'Na casa de {n}, ele vai ficar amarrado, ou sozinho num quintal ou terraço?',
        'form.q_lastAnimal_title': 'O que aconteceu com o seu último animal?',
        'form.q_lastAnimal_title_gift': 'O que aconteceu com o último animal de {n}?',
        'form.opt_last_withMe': 'Ainda está comigo',
        'form.opt_last_oldAge': 'Morreu de velhice ou doença',
        'form.opt_last_lost': 'Se perdeu ou fugiu',
        'form.opt_last_street': 'Morreu na rua (atropelado, envenenado)',
        'form.opt_last_gave': 'Eu dei ou doei',
        'form.opt_last_first': 'É a minha primeira vez',
        'form.q_gaveAway_title': 'Você já deu ou doou um animal?',
        'form.q_gaveAway_title_gift': '{n} já deu ou doou um animal?',
        'form.gaveAway_why': 'Por quê?',
        'form.q_sterilizeHow_title': 'Como você faria a castração?',
        'form.q_sterilizeHow_title_gift': 'Como fariam a castração?',
        'form.opt_sterilize_done': 'Já é castrado',
        'form.opt_sterilize_vet': 'Com meu veterinário',
        'form.opt_sterilize_campaign': 'Numa campanha gratuita',
        'form.q_movingIfNoPets_title': 'Se você se mudar e não aceitarem animais, o que faria?',
        'form.q_movingIfNoPets_title_gift': 'Se {n} se mudar e não aceitarem animais, o que faria?',
        'form.opt_moving_find': 'Procuro outro lugar que aceite',
        'form.opt_moving_family': 'Deixo com um familiar',
        'form.opt_moving_return': 'Devolvo ou dou',
        'form.q_returnReasons_title': 'Existe algo pelo qual você o devolveria?',
        'form.opt_return_no': 'Não',
        'form.opt_return_allergy': 'Alergia',
        'form.opt_return_baby': 'Um bebê',
        'form.opt_return_behaviour': 'Problemas de comportamento',
        'form.opt_return_other': 'Outro',
        'form.q_adaptPlan_title': 'Se ele quebrar coisas, fizer as necessidades em casa ou não se der bem com seu outro animal…',
        'form.opt_adapt_patience': 'Tenho paciência ou procuro um adestrador',
        'form.opt_adapt_askRescue': 'Peço ajuda ao abrigo',
        'form.opt_adapt_return': 'Devolvo',
        'form.q_visitConsent_title': 'Você aceita uma visita ou videochamada para conhecer onde ele vai morar, e que entremos em contato depois para saber como ele está?',
        'form.opt_visit_videoOnly': 'Só videochamada',
        'form.q_social_title': 'Você tem Instagram ou Facebook?',
        'form.q_social_subtitle': 'Nos ajuda a conhecer você e saber dele depois. É opcional.',
        'form.field_instagram': 'Instagram',
        'form.field_facebook': 'Facebook',
        'form.field_social_placeholder': '@usuario',
        'form.q_vetReference_title': 'Você tem veterinário?',
        'form.field_vetReference': 'Nome ou telefone (opcional)',
        'form.q_motivation_title': 'Conte um pouco mais',
        'form.field_motivation': 'Por que você quer adotar?',
        'form.field_howHeard': 'Como você nos conheceu?',
        // ── Gift flow (spec Part 2) ──
        'form.q_gift_recipient_title': 'Para quem é?',
        'form.q_gift_recipient_subtitle': 'A pessoa que vai morar com o animal',
        'form.gift_first_name': 'Nome',
        'form.gift_phone': 'Telefone (opcional)',
        'form.err_gift_recipient': 'Escolha a relação e escreva o nome.',
        'form.err_gift_phone': 'Confira o telefone: só números, espaços e + ( ) -.',
        'form.opt_unknown': 'Não sei',
        'form.q_children_title_gift': 'Há crianças na casa de {n}?',
        'form.q_existing_pets_title_gift': '{n} tem animais atualmente?',
        'form.q_housing_title_gift': 'Onde {n} mora?',
        'form.q_outdoor_title_gift': '{n} tem quintal ou jardim?',
        'form.q_pet_experience_title_gift': '{n} já teve animais?',
        'form.q_sterilize_title_gift': '{n} aceita castrar o animal?',
        'form.q_moving_title_gift': '{n} pensa em se mudar em breve?',
        'form.q_vacation_title_gift': 'O que {n} faria com o animal nas férias?',
        'form.q_household_title_gift': 'Quem mora com {n}?',
        'form.q_household_subtitle_gift': 'Sem contar {n}',
        'form.household_alone_gift': 'Não mora com ninguém',
        // ── Household people (spec 2026-10-04) ──
        'form.q_household_title_house': 'Quem mora na casa?',
        'form.q_household_title_apartment': 'Quem mora no apartamento?',
        'form.q_household_title_home': 'Quem mora na sua casa?',
        'form.q_household_subtitle': 'Sem contar você',
        'form.household_alone': 'Moro sozinho/a',
        'form.household_add': 'Adicionar pessoa',
        'form.household_relationship': 'Relação',
        'form.household_age': 'Idade',
        'form.household_first_name': 'Nome (opcional)',
        'form.household_last_name': 'Sobrenome (opcional)',
        'form.household_save': 'Salvar',
        'form.household_cancel': 'Cancelar',
        'form.household_edit': 'Editar',
        'form.household_remove': 'Remover',
        'form.household_years': '{n} anos',
        'form.err_household': 'Adicione as pessoas que moram com você ou escolha “Moro sozinho/a”.',
        'form.rel_partner': 'Parceiro/a',
        'form.rel_child': 'Filho/a',
        'form.rel_parent': 'Pai/Mãe',
        'form.rel_sibling': 'Irmão/Irmã',
        'form.rel_other_relative': 'Outro parente',
        'form.rel_housemate': 'Amigo/a ou colega',
        // ── Step navigation ──
        'form.step_of': 'Passo {n} de {total}',
        'form.continue': 'Continuar →',
        'form.back': '← Voltar',
        'form.submit': 'Enviar',
        'form.submitting': 'Enviando...',

        // ── Consent (legal) ──
        'form.legal_title': 'Solicitação de adoção',
        'form.legal_body': 'Preencha este breve formulário para registrar seu interesse em adotar. Isso nos ajuda a encontrar o animal ideal conforme o que você procura. O resgatista vai analisar sua solicitação para entrar em contato.',
        'form.consent_accept_prefix': 'Aceito os',
        'form.consent_terms_link': 'Termos e Condições',
        'form.consent_conforms': 'Conforme {ref}',

        // ── Shared answers ──
        'form.opt_yes': 'Sim',
        'form.opt_no': 'Não',
        'form.opt_other': 'Outro',

        // ── Species ──
        'form.q_species_title': 'Que animal você procura?',
        'form.opt_dog': 'Cão',
        'form.opt_cat': 'Gato',

        // ── Life stage ──
        'form.q_lifestage_title': 'Que idade você prefere?',
        'form.opt_puppy': 'Filhote',
        'form.opt_young': 'Jovem',
        'form.opt_senior': 'Idoso',
        'form.opt_no_preference': 'Sem preferência',

        // ── Special needs ──
        'form.q_special_needs_label': 'Aberto a necessidades especiais',
        'form.q_special_needs_desc': 'Ex.: gatos com DRC, animais com deficiência ou cuidado crônico.',

        // ── Intent ──
        'form.q_intent_title': 'É para você ou é um presente?',
        'form.opt_intent_self': 'Para mim',
        'form.opt_intent_gift': 'É um presente',

        // ── Children ──
        'form.q_children_title': 'Há crianças na casa?',

        // ── Existing pets ──
        'form.q_existing_pets_title': 'Você tem pets atualmente?',
        'form.q_existing_pets_subtitle': 'Toque em cada ícone para adicionar um pet desse tipo',
        'form.opt_dogs': 'Cães',
        'form.opt_cats': 'Gatos',
        'form.opt_birds': 'Pássaros',

        // ── Housing type ──
        'form.q_housing_title': 'Onde você mora?',
        'form.opt_house': 'Casa',
        'form.opt_apartment': 'Apartamento',

        // ── Outdoor space ──
        'form.q_outdoor_title': 'Você tem pátio ou jardim?',

        // ── Is safe ──
        'form.q_is_safe_title': 'O espaço é protegido?',
        'form.opt_safe_yes': 'Sim, é fechado',
        'form.opt_safe_no': 'Não é fechado',
        'form.opt_na': 'Não se aplica',

        // ── Hours alone ──
        'form.q_hours_alone_title': 'Quantas horas por dia o animal ficaria sozinho?',

        // ── Pet experience ──
        'form.q_pet_experience_title': 'Você já teve pets antes?',
        'form.opt_exp_none': 'Não, primeira vez',
        'form.opt_exp_cat': 'Sim, gato',
        'form.opt_exp_dog': 'Sim, cão',
        'form.opt_exp_other': 'Sim, outro',

        // ── Willing to sterilize ──
        'form.q_sterilize_title': 'Você está disposto(a) a castrar?',

        // ── Vet commitment ──
        'form.q_vet_label': 'Comprometo-me a levar o animal ao veterinário',
        'form.q_vet_desc': 'Vacinação, controles e atendimento quando necessário',

        // ── Moving plans ──
        'form.q_moving_title': 'Você pretende se mudar em breve?',
        'form.opt_moving_maybe': 'Possivelmente',

        // ── Vacation plan ──
        'form.q_vacation_title': 'O que você faria com o animal nas férias?',
        'form.opt_vac_take': 'Levo comigo',
        'form.opt_vac_family': 'A família cuida',
        'form.opt_vac_sitter': 'Cuidador / hospedagem',
        'form.opt_vac_unsure': 'Ainda não sei',

        // ── Identity: name ──
        'form.q_name_title': 'Como você se chama?',
        'form.field_name_label': 'Nome completo',
        'form.field_name_placeholder': 'João Silva',

        // ── Identity: email ──
        'form.q_email_title': 'Qual é o seu email?',
        'form.field_email_label': 'Email',
        'form.field_email_placeholder': 'joao@exemplo.com',

        // ── Identity: phone ──
        'form.q_phone_title': 'Seu telefone?',
        'form.field_phone_label': 'Telefone',
        'form.field_phone_placeholder': 'Código do país + número',

        // ── Identity: address ──
        'form.q_address_title': 'Onde você mora?',
        'form.field_address_label': 'Endereço',
        'form.field_address_placeholder': 'Rua, número, cidade, país',

        // ── Age range ──
        'form.q_age_title': 'Quantos anos você tem?',

        // ── Geolocation ──
        'form.q_geo_question': 'Você está atualmente na sua residência?',
        'form.geo_yes': 'Sim, estou em casa',
        'form.geo_subtitle': 'Isso nos ajuda a verificar sua localização. É opcional.',
        'form.geo_obtained': 'Localização obtida',

        // ── Selfie / camera-upload ──
        'form.q_selfie_title': 'Verificação de identidade',
        'form.q_selfie_instructions': 'Tire uma selfie ou envie uma foto sua para verificar sua identidade.',
        'form.selfie_alt': 'Selfie',
        'form.change_photo': 'Trocar foto',
        'form.take_selfie': '📸 Tirar selfie',
        'form.gallery_pick': 'Ou escolha uma foto da sua galeria',
        'form.file_hint': 'JPG, PNG — máx 5MB',
        'form.selfie_optional': 'Esta etapa é opcional — você pode continuar sem foto',

        // ── Pet counter ──
        'form.counter_subtract': '− Subtrair',
        'form.counter_none': 'Se você não tem pets, continue para a próxima etapa',

        // ── Keyboard hint ──
        'form.kbd_hint_prefix': 'Pressione',
        'form.kbd_hint_suffix': 'para continuar',

        // ── Validation ──
        'form.err_must_accept': 'Você precisa aceitar para continuar',
        'form.err_required': 'Campo obrigatório',
        'form.err_email': 'Email inválido',
        'form.err_format': 'Formato inválido',
        'form.err_select_option': 'Selecione uma opção',

        // ── Toasts / errors ──
        'form.err_invalid_link_user': 'Erro: link inválido — falta ID de usuário',
        'form.err_unknown': 'Erro desconhecido',
        'form.err_submit': 'Erro ao enviar',
        'form.err_network': 'Erro de rede. Verifique sua conexão e tente de novo.',
        'form.err_geo': 'Não foi possível obter a localização. Você pode continuar sem ela.',
        'form.err_images_only': 'Somente imagens são permitidas.',
        'form.err_selfie_read': 'Não conseguimos ler essa foto. Tente outra ou tire de novo.',
        'form.err_selfie_not_saved': 'Seu formulário foi enviado, mas a foto não pôde ser salva. Se pedirem, envie por outro meio.',

        // ── Completion / invalid-link screens ──
        'form.complete_title': 'Pronto!',
        'form.complete_desc': 'Sua solicitação foi enviada com sucesso. O resgatista receberá suas informações e entrará em contato em breve.',
        'form.invalid_link_title': 'Link inválido',
        'form.invalid_link_desc': 'Este formulário precisa de um link válido. Peça um novo ao resgatista.',
    },
};
