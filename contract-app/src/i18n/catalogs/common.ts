import type { CatalogSlice } from '../types';

// Shared chrome strings used across more than one screen (loading, errors,
// generic actions). Screen-specific strings live in their own slice.
export const common: CatalogSlice = {
    es: {
        'common.loading': 'Cargando…',
        'common.retry': 'Reintentar',
        'common.network_error': 'Error de red',
        'common.not_found': 'No encontrado',
        'common.not_found_title': 'Página no encontrada',
        'common.not_found_body': 'Verificá que el link sea correcto.',
        'common.view_animals_cta': 'Ver animales en adopción',
        'common.something_wrong': 'Algo salió mal',
        'common.error_persist_hint': 'Si el problema persiste, intentá abrir el enlace de nuevo.',
    },
    en: {
        'common.loading': 'Loading…',
        'common.retry': 'Try again',
        'common.network_error': 'Network error',
        'common.not_found': 'Not found',
        'common.not_found_title': 'Page not found',
        'common.not_found_body': 'Check that the link is correct.',
        'common.view_animals_cta': 'See animals for adoption',
        'common.something_wrong': 'Something went wrong',
        'common.error_persist_hint': 'If the problem persists, try opening the link again.',
    },
    pt: {
        'common.loading': 'Carregando…',
        'common.retry': 'Tentar novamente',
        'common.network_error': 'Erro de rede',
        'common.not_found': 'Não encontrado',
        'common.not_found_title': 'Página não encontrada',
        'common.not_found_body': 'Verifique se o link está correto.',
        'common.view_animals_cta': 'Ver animais para adoção',
        'common.something_wrong': 'Algo deu errado',
        'common.error_persist_hint': 'Se o problema persistir, tente abrir o link novamente.',
    },
};
