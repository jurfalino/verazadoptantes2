/**
 * Gemini Vision API Client (Official SDK)
 * 
 * Used for extracting structured data from:
 * - Facebook post text
 * - Screenshots (OCR for phone numbers, names, etc.)
 */

import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { getRequestContext } from '@cloudflare/next-on-pages';
import { logger } from '@/lib/logger';
import { parseColumnMap, TARGET_IMPORT_FIELDS, COMBINED_CONTACT, IGNORE, type ColumnMap } from '@/domain/importFields';

// Extracted adopter data from AI
export interface ExtractedAdopterData {
    name?: string;
    phones?: string[];
    emails?: string[];
    addresses?: string[];
    socialProfiles?: string[];
    notes?: string;
    confidence: 'high' | 'medium' | 'low';
    rawExtraction?: string;
    // Adoption detection
    adoptionDetected?: boolean;
    animalName?: string;
    animalSpecies?: string;
    adoptionConfidence?: 'high' | 'medium' | 'low';
    recordType?: 'adoption' | 'adoption_request' | 'returned_pet' | 'follow_up' | 'observation';
    adoptionRating?: number; // 1-5 rating for the adoption
    adoptionDate?: string; // YYYY-MM-DD format if mentioned in the post
}

function getGeminiApiKey(): string {
    try {
        const { env } = getRequestContext();
        return env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    } catch {
        return process.env.GEMINI_API_KEY || '';
    }
}

function getExtractionPrompt(language: string = 'es'): string {
    const langInstruction = language === 'en'
        ? 'IMPORTANT: Return ALL text fields (notes, addresses, etc.) in English. Names and proper nouns should remain as-is.'
        : 'IMPORTANTE: Devuelve TODOS los campos de texto (notas, direcciones, etc.) en Español. Los nombres propios deben permanecer como están.';

    return `You are a data extraction assistant for a pet adoption vetting system. 
Extract contact information from the following content (text and/or images from a social media post).

CRITICAL ACCURACY RULES:
- ONLY extract information that is EXPLICITLY written in the text or CLEARLY VISIBLE in the images.
- NEVER infer, guess, or construct data that is not directly present.
- Do NOT construct URLs from usernames. If you see "@user123", return EXACTLY "@user123" as-is, do NOT turn it into "instagram.com/user123" or "facebook.com/user123".
- Prefer returning null or empty arrays over guessing. Empty fields are ALWAYS better than incorrect data.

SOCIAL PROFILES — CRITICAL:
- ALWAYS extract any @handles, usernames, or profile links you see in the text or images into socialProfiles.
- Include ALL @handles (e.g. "@rescuepets", "@maria.lopez.22") — these are valuable contact data even if the platform is unknown.
- Common Instagram patterns: "ig: @handle", "insta: @handle", "instagram: @handle", "📷 @handle", "IG @handle", or just a standalone "@handle" in a bio/post.
- If a full URL is present (e.g. "instagram.com/user"), return the full URL as-is.
- If only a @handle is present, return it as-is (e.g. "@maria.lopez").
- Do NOT skip or omit @handles. When in doubt, INCLUDE the handle.

Extract the following if EXPLICITLY present:
- Full name (of the person being reported, not the poster)
- Phone numbers (must be clearly written or visible — do NOT guess or construct phone numbers)
- Email addresses (must contain @ and a domain — do NOT fabricate)
- Physical addresses
- Social media profiles (see SOCIAL PROFILES rules above — extract ALL @handles and profile links)
- Any other relevant notes about the person

ADOPTION DETECTION:
Also determine if this post indicates that an adoption has been completed or is being announced.
Look for phrases like "ya adoptado", "ya tiene hogar", "fue adoptado", "adopted", "has a home", "found a home", etc.
If an adoption is mentioned, extract the animal's name, species, and the date of the adoption if mentioned.
For the adoption date, look for explicit dates, relative dates ("yesterday", "last week", "hace 2 días"), or contextual dates from the post. Return in YYYY-MM-DD format, or null if no date is mentioned.

RATING: If an adoption is detected, assign a rating from 1 to 5 based on your assessment:
- 1 = Concerning (red flags, rushed adoption, unknown person)
- 2 = Low confidence (limited info, cannot verify)
- 3 = Neutral (some info but not enough to assess)
- 4 = Positive (good signs, responsive adopter)
- 5 = Excellent (verified, thorough process)
For most adoption announcements from rescue groups where you have minimal information about the adopter, default to rating 2 (low confidence).

RECORD TYPE CLASSIFICATION — CRITICAL:
You MUST ALWAYS classify the post into one of these record types:
- "adoption" = The post announces a COMPLETED adoption (animal has been placed with someone).
- "adoption_request" = Someone is REQUESTING to adopt, looking for a pet, or asking about availability.
- "follow_up" = A post about an animal that was PREVIOUSLY adopted (update, how the pet is doing, photos after adoption).
- "observation" = Any other relevant interaction — includes denunciations, cruelty reports, animal abuse, missing pets, rescue requests, or general notes about a person. When in doubt, use "observation".
- "returned_pet" = An adopted animal was RETURNED to the rescue/shelter.
The recordType must NEVER be null. Default to "observation" if uncertain.

Set "adoptionDetected" to true if recordType is "adoption", otherwise false.

${langInstruction}

Respond ONLY with valid JSON in this exact format:
{
  "name": "string or null",
  "phones": ["array of phone strings"],
  "emails": ["array of email strings"],
  "addresses": ["array of address strings"],
  "socialProfiles": ["MUST include ALL @handles and profile links found — never omit them"],
  "notes": "any other relevant information as a string",
  "confidence": "high" | "medium" | "low",
  "adoptionDetected": true | false,
  "recordType": "adoption" | "adoption_request" | "follow_up" | "observation" | "returned_pet",
  "animalName": "name of the animal or null",
  "animalSpecies": "dog" | "cat" | "bird" | "other" | null,
  "adoptionConfidence": "high" | "medium" | "low" | null,
  "adoptionRating": 1-5 or null,
  "adoptionDate": "YYYY-MM-DD or null"
}

If you cannot extract any relevant information, return:
{"name": null, "phones": [], "emails": [], "addresses": [], "socialProfiles": [], "notes": "", "confidence": "low", "adoptionDetected": false, "recordType": "observation", "animalName": null, "animalSpecies": null, "adoptionConfidence": null, "adoptionRating": null, "adoptionDate": null}
`;
}

/**
 * Extract adopter data from text and/or images using Gemini Vision
 */
export async function extractAdopterData(
    text?: string,
    images?: Array<{ data: string; mimeType: string }>, // base64 data and mime type
    // gemini-2.0-flash was retired in 2026 and now 404s. Default updated to
    // gemini-2.5-flash (v2.16.0-41). The /api/ai/extract-from-post route
    // looks up the `GEMINI_DEFAULT_MODEL` admin setting first; this baked-in
    // default only fires if (a) no body.model passed AND (b) no admin
    // override is set. Admins can override via /admin/config without a
    // deploy when the next model is retired.
    modelName: string = "gemini-2.5-flash",
    language: string = "es"
): Promise<ExtractedAdopterData> {
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const parts: Part[] = [];

    // System prompt (as text part)
    parts.push({ text: getExtractionPrompt(language) });

    // User text
    if (text?.trim()) {
        parts.push({ text: `\n\nPost content:\n${text}` });
    }

    // Images
    if (images && images.length > 0) {
        parts.push({ text: '\n\nImages from the post:' });
        for (const img of images) {
            parts.push({
                inlineData: {
                    mimeType: img.mimeType,
                    data: img.data,
                },
            });
        }
    }

    // Validate input
    if (!text?.trim() && (!images || images.length === 0)) {
        throw new Error('No text or images provided');
    }

    try {
        const result = await model.generateContent(parts);
        const response = await result.response;
        const responseText = response.text();

        if (!responseText) {
            throw new Error('No text in response');
        }

        // Parse the JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const parsed = JSON.parse(jsonMatch[0]) as ExtractedAdopterData;
        parsed.rawExtraction = responseText;

        return parsed;

    } catch (error) {
        logger.error('Gemini extraction failed', error);
        return {
            confidence: 'low',
            notes: `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
            rawExtraction: String(error),
        };
    }
}

/**
 * Spreadsheet column-mapper. Given the sheet's headers + a few sample rows, ask
 * the model to classify each column into one of our target fields (see
 * TARGET_IMPORT_FIELDS), or `combined_contact` (a messy cell holding several
 * contact types) / `ignore`. ONE call per file — rows are then applied
 * deterministically. Falls back to an all-`ignore` map on any failure so the
 * user can still map manually. Response validated by `parseColumnMap` (never
 * trusts the raw model output). See .claude plan: spreadsheet import.
 */
function getColumnMapPrompt(headers: string[], sampleRows: string[][], language: string): string {
    const fieldList = TARGET_IMPORT_FIELDS.map(f => `  - "${f.key}": ${f.hint}`).join('\n');
    // Render a compact sample table so the model sees example values per column.
    const sample = [headers.join(' | '), ...sampleRows.slice(0, 5).map(r => headers.map((_, i) => (r[i] ?? '')).join(' | '))].join('\n');
    const lang = language === 'en' ? 'English' : 'Spanish';
    return `You are mapping columns of an adoption-records spreadsheet to a fixed schema for a pet-adoption vetting system.

For EACH column header below, decide which target field it best represents. Valid targets:
${fieldList}
  - "${COMBINED_CONTACT}": the column holds SEVERAL contact types mixed together (e.g. phone + email + address in one cell). Use this so we can split it per-row later.
  - "${IGNORE}": the column is irrelevant or has no clear target.

RULES:
- Judge by BOTH the header name and the sample values.
- Assign each column exactly once. Never invent columns.
- Exactly one column should map to "name" when a name column exists; if several could be the name, pick the most likely and mark the others appropriately.
- Set confidence to "high" only when header + sample values clearly agree; "low" when guessing.
- Any notes should be in ${lang}.

Headers: ${JSON.stringify(headers)}

Sample rows (pipe-separated, header row first):
${sample}

Return ONLY JSON in this exact shape (no prose, no markdown):
{"columns":[{"column":"<exact header>","field":"<target key>","confidence":"high|medium|low"}],"notes":"<optional>"}`;
}

export async function mapSpreadsheetColumns(
    headers: string[],
    sampleRows: string[][],
    modelName: string = "gemini-2.5-flash",
    language: string = "es",
): Promise<ColumnMap> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    if (!headers.length) return parseColumnMap(null, headers);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    try {
        const result = await model.generateContent(getColumnMapPrompt(headers, sampleRows, language));
        const responseText = (await result.response).text() || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        return parseColumnMap(raw, headers);
    } catch (error) {
        // Fall open to an all-ignore map — the user maps manually rather than the
        // whole flow breaking. Logged (not silent) so a persistent AI outage shows.
        logger.error('Gemini column-mapping failed', error, { headerCount: headers.length });
        return parseColumnMap(null, headers);
    }
}

/**
 * Fetch list of available models from Gemini API
 */
export async function getAvailableModels(): Promise<Array<{ name: string; displayName: string }>> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) return [];

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            logger.warn('Failed to list Gemini models', { status: response.status });
            return [];
        }

        const data = await response.json() as { models: Array<{ name: string; displayName: string; supportedGenerationMethods: string[] }> };

        return data.models
            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
            .map(m => ({
                name: m.name.replace('models/', ''),
                displayName: m.displayName
            }))
            .sort((a, b) => b.name.localeCompare(a.name)); // Newest first usually
    } catch (error) {
        logger.error('Error listing Gemini models', error);
        return [];
    }
}
