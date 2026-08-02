// Barrel re-export — preserves the public API so all existing imports
// from '@/app/actions' continue to work without changes.

// Types
export type { AdopterFlags } from '@/types/adopter';
export type { SearchResult, SearchResponse, SnippetField, MatchSnippet } from './types';

// DB helpers
export { getDb, getUser, getIsAdmin, getIsModeratorOrAdmin } from './_db';

// Config
export { getAdoptionConfig } from './config';

// Unified search engine
export { findAdopters } from './findAdopters';
export type { FindAdoptersInput, FindAdoptersOptions, FindAdoptersResponse, DuplicateMatch, DiscoveryMatch, AdopterMatch, SearchMode } from './types';

// Adopters
export { getAdopter, saveAdopter, appendToExistingAdopter, getAdopterStats, logProfileView, getAverageRating, getHistory, getLinkedFormSubmissions, checkAdopterDeletable, deleteOwnAdopter, requestAdopterDeletion } from './adopters';
export { addContactEntry } from './addContactEntry';
export { updateContactEntry } from './updateContactEntry';
export { removeContactEntry } from './removeContactEntry';
export { grantSearchMatchAccess } from './grantSearchMatchAccess';

// Images
export { saveImage, getImages, getAllAdopterImages, setProfilePicture, getAdoptionImages, deleteImage } from './images';

// Adoptions
export { saveAdoption, deleteAdoption, getAdoptions, getAvailableAnimals, deleteAnimalForAdoption, deleteAnimalImage } from './adoptions';

// Spreadsheet import
export { mapImportColumns, interpretRows, aiCleanRowContacts } from './importSheet';

// Flags
export { flagAdopter, getFlags, dismissFlag, removeVerification } from './flags';

// Dashboard
export { getMyAdopters, getMyAdoptions } from './dashboard';

// Admin
export { runAdminQuery, deleteAdopter, resolveDataRequest, listDeletedAdopters, restoreAdopter, purgeAdopter, purgeDeletedAdopters, purgeAllData, backfillLegacyContactEntries, backfillAdopterCountries, setAdopterPublic, transferAdopterOwnership } from './admin';

// Duplicates
export { getDuplicateCandidates, checkTokenDuplicates } from './duplicates';
export type { DuplicateCandidate, TokenMatchResult } from './duplicates';
export { flagAdopterAsDuplicate } from './flagAdopterAsDuplicate';

// Enrichment
export { enrichAdopters } from './enrichAdopters';
export type { EnrichmentResult } from './enrichAdopters';

// Notifications — import directly from '@/app/actions/notifications' (server-side only)

// Admin metrics
export { fetchMetrics } from './metrics';
export type { MetricsPayload, MetricCardData } from './metrics';
