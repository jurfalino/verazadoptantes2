/**
 * The selfie "URL" every loader returns: a privately stored selfie becomes its
 * access-checked route (/api/files/selfie/{id}); an older public upload keeps
 * its URL until it is moved. The storage key itself never leaves the server.
 * Server-only (a SQL expression for drizzle selects).
 */
import { sql } from 'drizzle-orm';
import { formSubmissions } from '@/db/schema';

export const selfieUrlColumn = sql<string | null>`CASE WHEN ${formSubmissions.selfieKey} IS NOT NULL THEN '/api/files/selfie/' || ${formSubmissions.id} ELSE ${formSubmissions.selfieUrl} END`;
