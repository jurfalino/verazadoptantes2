/**
 * AI Extraction using Cloudflare Workers AI
 * 
 * Uses the LLaVA vision model for image understanding
 * and Llama for text extraction - both free on Cloudflare
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

const EXTRACTION_PROMPT = `You are a data extraction assistant for a pet adoption vetting system. 
Extract contact information from the following content.

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
 * Get AI binding from Cloudflare Workers context
 */
function getAI(): Ai | null {
    try {
        const { env } = getRequestContext();
        const ai = (env as { AI?: Ai })?.AI;
        return ai || null;
    } catch (error) {
        console.error('[AI] Error accessing request context:', error);
        return null;
    }
}

/**
 * Extract text from an image using LLaVA vision model
 */
async function extractTextFromImage(ai: Ai, imageData: string, mimeType: string): Promise<string> {
    try {
        // Convert base64 to Uint8Array
        const binaryString = atob(imageData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const response = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [...bytes], // LLaVA expects array of numbers
            prompt: 'Extract all text visible in this image, including phone numbers, names, and addresses. Return the raw text only.',
            max_tokens: 512,
        });

        return (response as { description?: string }).description || '';
    } catch (error) {
        console.error('[AI] LLaVA extraction failed:', error);
        return '';
    }
}

/**
 * Extract structured data from text using Llama
 */
async function extractStructuredData(ai: Ai, text: string): Promise<ExtractedAdopterData> {
    try {
        // Use type assertion for model name since types may be outdated
        const response = await (ai.run as (model: string, inputs: unknown) => Promise<{ response?: string }>)(
            '@cf/meta/llama-3.1-8b-instruct',
            {
                messages: [
                    { role: 'system', content: EXTRACTION_PROMPT },
                    { role: 'user', content: `Content to extract from:\n\n${text}` }
                ],
                max_tokens: 1024,
            }
        );

        const responseText = (response as { response?: string }).response || '';

        // Parse JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { confidence: 'low', notes: 'No structured data found', rawExtraction: responseText };
        }

        const parsed = JSON.parse(jsonMatch[0]) as ExtractedAdopterData;
        parsed.rawExtraction = responseText;
        return parsed;
    } catch (error) {
        console.error('[AI] Llama extraction failed:', error);
        return { confidence: 'low', notes: 'Extraction failed', rawExtraction: String(error) };
    }
}

/**
 * Extract adopter data from text and/or images using Cloudflare Workers AI
 */
export async function extractAdopterData(
    text?: string,
    images?: Array<{ data: string; mimeType: string }>
): Promise<ExtractedAdopterData> {
    const ai = getAI();

    if (!ai) {
        throw new Error('Cloudflare AI not available. Make sure AI binding is configured.');
    }

    let combinedText = text?.trim() || '';

    // Extract text from images using vision model
    if (images && images.length > 0) {

        for (const img of images) {
            const imageText = await extractTextFromImage(ai, img.data, img.mimeType);
            if (imageText) {
                combinedText += '\n\n[Image content]:\n' + imageText;
            }
        }
    }

    if (!combinedText.trim()) {
        return { confidence: 'low', notes: 'No content to extract from' };
    }

    return extractStructuredData(ai, combinedText);
}
