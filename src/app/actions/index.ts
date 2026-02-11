// Barrel re-export — preserves the public API so all existing imports
// from '@/app/actions' continue to work without changes.

// Types
export type { AdopterFlags, SearchResult, SearchResponse } from './types';

// DB helpers
export { getDb, getUser, getIsAdmin } from './_db';

// Config
export { getAdoptionConfig } from './config';

// Search
export { searchAdopter } from './search';

// Adopters
export { getAdopter, saveAdopter, getAdopterStats, logProfileView, getAverageRating, getHistory } from './adopters';

// Images
export { saveImage, getImages, setProfilePicture, getAdoptionImages, deleteImage } from './images';

// Adoptions
export { saveAdoption, deleteAdoption, getAdoptions, getAvailableAnimals } from './adoptions';

// Flags
export { flagAdopter, getFlags, dismissFlag, removeVerification } from './flags';

// Dashboard
export { getMyAdopters, getMyAdoptions } from './dashboard';

// Admin
export { runAdminQuery, deleteAdopter, purgeAllData } from './admin';
