export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

interface FetchedContent {
    title?: string;
    text: string;
    images: string[];
    sourceUrl: string;
    sourceType: 'facebook' | 'instagram' | 'web' | 'unknown';
}

/**
 * Universal content fetcher — extracts text & images from any URL.
 * For Facebook URLs, delegates to the existing /api/facebook/fetch-post.
 */
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
        const body = await request.json() as { url?: string; text?: string };
        const { url, text } = body;

        // If raw text was provided (no URL), return it directly
        if (!url && text?.trim()) {
            return NextResponse.json({
                success: true,
                data: {
                    text: text.trim(),
                    images: [],
                    sourceUrl: '',
                    sourceType: 'unknown',
                } satisfies FetchedContent,
            });
        }

        if (!url) {
            return NextResponse.json({ error: 'URL or text is required' }, { status: 400 });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
        }

        const sourceType = detectSourceType(url);

        // For Facebook URLs, delegate to the specialized scraper
        if (sourceType === 'facebook') {
            return NextResponse.json({
                success: true,
                isFacebook: true,
                sourceType: 'facebook',
                message: 'Use /api/facebook/fetch-post for Facebook URLs',
            });
        }

        // Generic URL fetching
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            return NextResponse.json({
                error: `Failed to fetch URL (status ${response.status})`,
            }, { status: 400 });
        }

        const contentType = response.headers.get('content-type') || '';

        // Handle images directly
        if (contentType.startsWith('image/')) {
            const buffer = await response.arrayBuffer();
            const base64 = btoa(
                new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            return NextResponse.json({
                success: true,
                data: {
                    text: '',
                    images: [`data:${contentType};base64,${base64}`],
                    sourceUrl: url,
                    sourceType,
                } satisfies FetchedContent,
            });
        }

        // Handle HTML pages
        const html = await response.text();
        const extracted = extractFromHtml(html, url);

        logger.info('Universal content fetch completed', {
            userEmail: session?.user?.email || 'anonymous',
            url,
            sourceType,
            textLength: extracted.text.length,
            imageCount: extracted.images.length,
        });

        return NextResponse.json({
            success: true,
            data: extracted,
        });

    } catch (error) {
        logger.error('Content fetch failed', error);
        return NextResponse.json({
            error: 'Failed to fetch content',
            requiresManualInput: true,
        }, { status: 500 });
    }
}

function detectSourceType(url: string): FetchedContent['sourceType'] {
    const lowerUrl = url.toLowerCase();
    if (/facebook\.com|fb\.com|fb\.watch/.test(lowerUrl)) return 'facebook';
    if (/instagram\.com|instagr\.am/.test(lowerUrl)) return 'instagram';
    return 'web';
}

/**
 * Extract text, title, and images from an HTML page.
 * Uses OG tags, JSON-LD, and fallback to body text.
 */
function extractFromHtml(html: string, sourceUrl: string): FetchedContent {
    const data: FetchedContent = {
        text: '',
        images: [],
        sourceUrl,
        sourceType: detectSourceType(sourceUrl),
    };
    const seenImages = new Set<string>();

    // --- OG Tags ---
    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const ogImageMatches = html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi);

    if (ogTitle) data.title = decodeEntities(ogTitle[1]);
    if (ogDesc) data.text = decodeEntities(ogDesc[1]);

    for (const match of ogImageMatches) {
        const imgUrl = match[1];
        if (imgUrl && !seenImages.has(imgUrl)) {
            seenImages.add(imgUrl);
            data.images.push(imgUrl);
        }
    }

    // --- JSON-LD ---
    const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
        try {
            const ld = JSON.parse(jsonLdMatch[1]) as {
                articleBody?: string;
                description?: string;
                name?: string;
                headline?: string;
                image?: string | string[];
                author?: { name?: string };
            };
            const ldText = ld.articleBody || ld.description || '';
            if (ldText.length > data.text.length) data.text = ldText;
            if (!data.title && (ld.headline || ld.name)) data.title = ld.headline || ld.name;
            if (ld.image) {
                const imgs = Array.isArray(ld.image) ? ld.image : [ld.image];
                for (const img of imgs) {
                    if (!seenImages.has(img)) { seenImages.add(img); data.images.push(img); }
                }
            }
        } catch (e) { console.warn('[fetch-content] JSON-LD parse failed', e); }
    }

    // --- Fallback: <title> tag ---
    if (!data.title) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) data.title = decodeEntities(titleMatch[1]).trim();
    }

    // --- Fallback: meta description ---
    if (!data.text) {
        const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (metaDesc) data.text = decodeEntities(metaDesc[1]);
    }

    // --- Fallback: Extract visible text from paragraphs ---
    if (!data.text || data.text.length < 50) {
        const paragraphs: string[] = [];
        const pMatches = html.matchAll(/<p[^>]*>([^<]+(?:<[^>]+>[^<]+)*)<\/p>/gi);
        for (const match of pMatches) {
            const cleanText = match[1].replace(/<[^>]+>/g, '').trim();
            if (cleanText.length > 20) paragraphs.push(cleanText);
        }
        const bodyText = paragraphs.join('\n\n');
        if (bodyText.length > data.text.length) {
            data.text = bodyText;
        }
    }

    // --- Extract images from <img> tags ---
    const imgMatches = html.matchAll(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of imgMatches) {
        const imgUrl = match[1].replace(/&amp;/g, '&');
        if (imgUrl && !seenImages.has(imgUrl) &&
            !imgUrl.includes('icon') && !imgUrl.includes('emoji') &&
            !imgUrl.includes('logo') && !imgUrl.includes('avatar') &&
            !imgUrl.includes('static')) {
            seenImages.add(imgUrl);
            data.images.push(imgUrl);
        }
    }

    // Limit images
    data.images = data.images.slice(0, 10);

    return data;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&aacute;/g, 'á')
        .replace(/&eacute;/g, 'é')
        .replace(/&iacute;/g, 'í')
        .replace(/&oacute;/g, 'ó')
        .replace(/&uacute;/g, 'ú')
        .replace(/&ntilde;/g, 'ñ')
        .replace(/&Aacute;/g, 'Á')
        .replace(/&Eacute;/g, 'É')
        .replace(/&Iacute;/g, 'Í')
        .replace(/&Oacute;/g, 'Ó')
        .replace(/&Uacute;/g, 'Ú')
        .replace(/&Ntilde;/g, 'Ñ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\n/g, '\n');
}
