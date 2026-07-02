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

        // ── Completion / invalid-link screens ──
        'form.complete_title': '¡Listo!',
        'form.complete_desc': 'Tu solicitud fue enviada exitosamente. El rescatista recibirá tu información y se pondrá en contacto pronto.',
        'form.invalid_link_title': 'Enlace inválido',
        'form.invalid_link_desc': 'Este formulario necesita un enlace válido. Pedí uno nuevo al rescatista.',
    },
    en: {
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

        // ── Completion / invalid-link screens ──
        'form.complete_title': 'Done!',
        'form.complete_desc': 'Your request was sent successfully. The rescuer will receive your information and get in touch soon.',
        'form.invalid_link_title': 'Invalid link',
        'form.invalid_link_desc': 'This form needs a valid link. Ask the rescuer for a new one.',
    },
    pt: {
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

        // ── Completion / invalid-link screens ──
        'form.complete_title': 'Pronto!',
        'form.complete_desc': 'Sua solicitação foi enviada com sucesso. O resgatista receberá suas informações e entrará em contato em breve.',
        'form.invalid_link_title': 'Link inválido',
        'form.invalid_link_desc': 'Este formulário precisa de um link válido. Peça um novo ao resgatista.',
    },
};
