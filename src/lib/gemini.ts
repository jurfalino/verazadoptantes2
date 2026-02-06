/**
 * Gemini Vision API Client (Official SDK)
 * 
 * Used for extracting structured data from:
 * - Facebook post text
 * - Screenshots (OCR for phone numbers, names, etc.)
 */

import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { getRequestContext } from '@cloudflare/next-on-pages';

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
}

function getGeminiApiKey(): string {
    try {
        const { env } = getRequestContext();
        return env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    } catch {
        return process.env.GEMINI_API_KEY || '';
    }
}

const EXTRACTION_PROMPT = `You are a data extraction assistant for a pet adoption vetting system. 
Extract contact information from the following content (text and/or images from a Facebook post).

Extract the following if present:
- Full name (of the person being reported, not the poster)
- Phone numbers (any format)
- Email addresses
- Physical addresses
- Social media profiles (Facebook, Instagram, etc.)
- Any other relevant notes about the person

IMPORTANT: The content may be in Spanish. Extract information in the original language.

Respond ONLY with valid JSON in this exact format:
{
  "name": "string or null",
  "phones": ["array of phone strings"],
  "emails": ["array of email strings"],
  "addresses": ["array of address strings"],
  "socialProfiles": ["array of social profile URLs or usernames"],
  "notes": "any other relevant information as a string",
  "confidence": "high" | "medium" | "low"
}

If you cannot extract any relevant information, return:
{"name": null, "phones": [], "emails": [], "addresses": [], "socialProfiles": [], "notes": "", "confidence": "low"}
`;

/**
 * Extract adopter data from text and/or images using Gemini Vision
 */
export async function extractAdopterData(
    text?: string,
    images?: Array<{ data: string; mimeType: string }>, // base64 data and mime type
    modelName: string = "gemini-1.5-flash"
): Promise<ExtractedAdopterData> {
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const parts: Part[] = [];

    // System prompt (as text part)
    parts.push({ text: EXTRACTION_PROMPT });

    // User text
    if (text?.trim()) {
        parts.push({ text: `\n\nFacebook Post Text:\n${text}` });
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
        console.error('Gemini extraction failed:', error);
        return {
            confidence: 'low',
            notes: `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
            rawExtraction: String(error),
        };
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
            console.error('Failed to list models:', await response.text());
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
        console.error('Error listing models:', error);
        return [];
    }
}
