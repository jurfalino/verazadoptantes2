/**
 * Gemini Vision API Client
 * 
 * Used for extracting structured data from:
 * - Facebook post text
 * - Screenshots (OCR for phone numbers, names, etc.)
 */

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

interface GeminiRequest {
    contents: Array<{
        parts: Array<{
            text?: string;
            inline_data?: {
                mime_type: string;
                data: string; // base64
            };
        }>;
    }>;
    generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
    };
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
    images?: Array<{ data: string; mimeType: string }> // base64 data and mime type
): Promise<ExtractedAdopterData> {
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const parts: GeminiRequest['contents'][0]['parts'] = [];

    // Add the system prompt
    parts.push({ text: EXTRACTION_PROMPT });

    // Add user-provided text
    if (text?.trim()) {
        parts.push({ text: `\n\nFacebook Post Text:\n${text}` });
    }

    // Add images
    if (images && images.length > 0) {
        parts.push({ text: '\n\nImages from the post:' });
        for (const img of images) {
            parts.push({
                inline_data: {
                    mime_type: img.mimeType,
                    data: img.data,
                },
            });
        }
    }

    // Validate we have something to process
    if (!text?.trim() && (!images || images.length === 0)) {
        throw new Error('No text or images provided');
    }

    const request: GeminiRequest = {
        contents: [{ parts }],
        generationConfig: {
            temperature: 0.1, // Low temperature for more consistent extraction
            maxOutputTokens: 1024,
        },
    };

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string }>;
            };
        }>;
    };

    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
        throw new Error('No response from Gemini API');
    }

    // Parse the JSON response
    try {
        // Extract JSON from the response (in case there's extra text)
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const parsed = JSON.parse(jsonMatch[0]) as ExtractedAdopterData;
        parsed.rawExtraction = responseText;

        return parsed;
    } catch (parseError) {
        // Return low confidence result if parsing fails
        return {
            confidence: 'low',
            notes: 'Failed to parse AI response',
            rawExtraction: responseText,
        };
    }
}
