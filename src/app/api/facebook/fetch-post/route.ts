export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

interface FacebookPostData {
    text: string;
    author?: string;
    images: string[];
    error?: string;
    isVideo?: boolean;
    videoThumbnailBase64?: string;
}

/**
 * Fetch content from a public Facebook post URL
 * Attempts multiple methods to extract post content
 */
export async function POST(request: NextRequest) {
    // Require authentication
    const session = await auth();
    const isAnon = request.cookies.get('anon_user')?.value === 'true';

    if (!session?.user && !isAnon) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
        const body = await request.json() as { url?: string; useFallback?: boolean };
        const { url, useFallback } = body;

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        // Validate Facebook URL (including share links)
        const fbUrlPattern = /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i;
        if (!fbUrlPattern.test(url)) {
            return NextResponse.json({ error: 'Please provide a valid Facebook URL' }, { status: 400 });
        }

        // Convert mobile URLs to desktop
        const desktopUrl = url.replace(/m\.facebook\.com/i, 'www.facebook.com');

        const userId = session?.user?.email || (isAnon ? 'anon' : 'unknown');

        // Try Playwright scraper service first (if configured and not explicitly using fallback)
        const scraperUrl = process.env.SCRAPER_URL;
        if (scraperUrl && !useFallback) {
            try {

                // Use 120s timeout as safety net (user can bail earlier via progress UI)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);

                const scraperResponse = await fetch(`${scraperUrl}/scrape`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(process.env.SCRAPER_API_KEY && { 'X-API-Key': process.env.SCRAPER_API_KEY })
                    },
                    body: JSON.stringify({ url: desktopUrl }),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (scraperResponse.ok) {
                    const scraperData = await scraperResponse.json() as {
                        success: boolean;
                        data?: { text: string; author?: string; images: string[] };
                        error?: string;
                    };

                    if (scraperData.success && scraperData.data) {

                        // Return scraper results if we got meaningful content
                        if (scraperData.data.images.length > 0 || scraperData.data.text.length > 50) {
                            // Detect video posts from URL patterns (Reels, /r/, /reel/)
                            const isVideoUrl = /\/(reel|r)\//.test(desktopUrl);
                            return NextResponse.json({
                                success: true,
                                data: {
                                    ...scraperData.data,
                                    ...(isVideoUrl && { isVideo: true }),
                                },
                                source: 'playwright',
                                ...(isVideoUrl && { isVideo: true }),
                            });
                        }
                    }
                }

                // Scraper returned no useful data — fall through to HTML fallback
                logger.warn('Facebook scraper returned no useful data, falling through to HTML fallback', {
                    userId,
                    url: desktopUrl,
                    scraperUrl,
                    reason: 'no_data',
                });
            } catch (scraperError: unknown) {
                const errorMessage = scraperError instanceof Error ? scraperError.message : String(scraperError);
                const isTimeout = scraperError instanceof Error && scraperError.name === 'AbortError';
                const reason = isTimeout ? 'timeout' : 'error';

                logger.warn('Facebook scraper unavailable, falling through to HTML fallback', {
                    userId,
                    url: desktopUrl,
                    scraperUrl,
                    reason,
                    errorMessage,
                    isTimeout,
                });
            }
        }

        // Try to fetch the page content (static HTML fallback)
        const response = await fetch(desktopUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });


        if (!response.ok) {
            return NextResponse.json({
                error: `Failed to fetch post (status ${response.status})`
            }, { status: 400 });
        }

        const html = await response.text();

        const postData = extractPostData(html);

        // For video posts, try to fetch the thumbnail and convert to base64 for OCR
        if (postData.isVideo && postData.images.length > 0) {
            try {
                const thumbnailUrl = postData.images[0];
                const thumbController = new AbortController();
                const thumbTimeout = setTimeout(() => thumbController.abort(), 5000);
                const thumbResponse = await fetch(thumbnailUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
                    signal: thumbController.signal,
                });
                clearTimeout(thumbTimeout);
                if (thumbResponse.ok) {
                    const contentType = thumbResponse.headers.get('content-type') || 'image/jpeg';
                    const buffer = await thumbResponse.arrayBuffer();
                    const base64 = btoa(
                        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                    );
                    postData.videoThumbnailBase64 = `data:${contentType};base64,${base64}`;
                    logger.info('Video thumbnail fetched for OCR', {
                        thumbnailSize: buffer.byteLength,
                        contentType,
                    });
                } else {
                    logger.warn('Video thumbnail fetch returned non-OK status', {
                        status: thumbResponse.status,
                        thumbnailUrl,
                    });
                }
            } catch (e) {
                logger.warn('Failed to fetch video thumbnail for OCR', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // If extraction fails, return failure so the UI can show an error with retry
        if (!postData.text && postData.images.length === 0) {
            return NextResponse.json({
                success: false,
                extractionFailed: true,
                error: 'No se pudo extraer contenido de esta publicación. Facebook puede estar bloqueando la solicitud temporalmente.',
            });
        }

        return NextResponse.json({
            success: true,
            data: postData,
            ...(postData.isVideo && { isVideo: true }),
        });

    } catch (error) {
        logger.error('Facebook fetch failed', error);
        return NextResponse.json({
            error: 'Failed to fetch Facebook post',
            requiresManualInput: true
        }, { status: 500 });
    }
}

/**
 * Extract post content from Facebook HTML
 * Facebook uses various techniques to render content, so we try multiple patterns
 */
function extractPostData(html: string): FacebookPostData {
    const data: FacebookPostData = {
        text: '',
        images: [],
    };
    const seenImages = new Set<string>();

    // Detect video posts via og:type
    const ogTypeMatch = html.match(/<meta\s+property="og:type"\s+content="([^"]+)"/i);
    if (ogTypeMatch && ogTypeMatch[1].startsWith('video')) {
        data.isVideo = true;
    }

    // Method 1: Look for Open Graph meta tags (most reliable for public posts)
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const ogImageMatches = html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi);

    if (ogTitleMatch) {
        data.author = decodeHtmlEntities(ogTitleMatch[1]);
    }

    if (ogDescMatch) {
        data.text = decodeHtmlEntities(ogDescMatch[1]);
    }

    for (const match of ogImageMatches) {
        const imageUrl = decodeHtmlEntities(match[1]);
        // Filter out profile pics and icons
        if (imageUrl && !imageUrl.includes('profile') && !imageUrl.includes('icon') && !seenImages.has(imageUrl)) {
            seenImages.add(imageUrl);
            data.images.push(imageUrl);
        }
    }

    // Method 2: Look for JSON-LD structured data
    const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
        try {
            const jsonData = JSON.parse(jsonLdMatch[1]) as {
                articleBody?: string;
                description?: string;
                author?: { name?: string };
                image?: string | string[];
            };
            if (jsonData.articleBody && jsonData.articleBody.length > data.text.length) {
                data.text = jsonData.articleBody;
            } else if (jsonData.description && jsonData.description.length > data.text.length) {
                data.text = jsonData.description;
            }
            if (jsonData.author?.name) {
                data.author = jsonData.author.name;
            }
            if (jsonData.image) {
                const images = Array.isArray(jsonData.image) ? jsonData.image : [jsonData.image];
                for (const img of images) {
                    if (!seenImages.has(img)) {
                        seenImages.add(img);
                        data.images.push(img);
                    }
                }
            }
        } catch {
            // JSON parse failed, continue with other methods
        }
    }

    // Method 3: Look for scontent images (Facebook CDN pattern)
    const scontentMatches = html.matchAll(/["'](https:\/\/scontent[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi);
    for (const match of scontentMatches) {
        let imageUrl = match[1];
        // Unescape URL encoding
        imageUrl = imageUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        // Filter out small thumbnails and profile pics
        if (imageUrl &&
            !imageUrl.includes('_s.') &&
            !imageUrl.includes('_t.') &&
            !imageUrl.includes('profile') &&
            !imageUrl.includes('emoji') &&
            !seenImages.has(imageUrl)) {
            seenImages.add(imageUrl);
            data.images.push(imageUrl);
        }
    }

    // Method 4: Look for lookaside images (another Facebook CDN pattern)
    const lookasideMatches = html.matchAll(/["'](https:\/\/lookaside[^"']+)/gi);
    for (const match of lookasideMatches) {
        let imageUrl = match[1];
        imageUrl = imageUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        if (imageUrl && !seenImages.has(imageUrl)) {
            seenImages.add(imageUrl);
            data.images.push(imageUrl);
        }
    }

    // Method 5: Extract text from escaped JSON content (Facebook embeds post text in JSON)
    const textPatterns = [
        /text"?\s*:\s*"([^"]{50,})"/g,
        /message"?\s*:\s*"([^"]{50,})"/g,
        /"rawText"?\s*:\s*"([^"]{50,})"/g,
    ];

    for (const pattern of textPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            const text = decodeHtmlEntities(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
            if (text.length > data.text.length && !text.includes('<!DOCTYPE')) {
                data.text = text;
            }
        }
    }

    // Method 6: Look for data-content-id patterns (Facebook's internal structure)
    const contentMatches = html.matchAll(/data-content-type="[^"]*"[^>]*>([^<]+)</gi);
    for (const match of contentMatches) {
        const content = match[1].trim();
        if (content.length > 50 && content.length > data.text.length) {
            data.text = decodeHtmlEntities(content);
        }
    }

    // Method 7: Generic image URLs from src attributes
    const imgMatches = html.matchAll(/src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of imgMatches) {
        let imageUrl = match[1];
        imageUrl = imageUrl.replace(/&amp;/g, '&');
        // Filter out small images, emojis, etc
        if (imageUrl &&
            !imageUrl.includes('emoji') &&
            !imageUrl.includes('icon') &&
            !imageUrl.includes('like') &&
            !imageUrl.includes('comment') &&
            !imageUrl.includes('static') &&
            !imageUrl.includes('_s.') &&
            !imageUrl.includes('_t.') &&
            !seenImages.has(imageUrl)) {
            seenImages.add(imageUrl);
            data.images.push(imageUrl);
        }
    }

    // Deduplicate images by comparing base URLs (without query params)
    const uniqueImages: string[] = [];
    const baseUrlsSeen = new Set<string>();
    for (const img of data.images) {
        const baseUrl = img.split('?')[0];
        if (!baseUrlsSeen.has(baseUrl)) {
            baseUrlsSeen.add(baseUrl);
            uniqueImages.push(img);
        }
    }

    // Limit to first 10 images (increased from 5)
    data.images = uniqueImages.slice(0, 10);

    return data;
}

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\\u003C/g, '<')
        .replace(/\\u003E/g, '>')
        .replace(/\\n/g, '\n');
}
