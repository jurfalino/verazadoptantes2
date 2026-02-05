export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

interface FacebookPostData {
    text: string;
    author?: string;
    images: string[];
    error?: string;
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
        const body = await request.json() as { url?: string };
        const { url } = body;

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

        console.log('[Facebook Fetch] Fetching URL:', desktopUrl);

        // Try to fetch the page content
        const response = await fetch(desktopUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });

        console.log('[Facebook Fetch] Response status:', response.status);

        if (!response.ok) {
            console.log('[Facebook Fetch] Failed with status:', response.status);
            return NextResponse.json({
                error: `Failed to fetch post (status ${response.status})`
            }, { status: 400 });
        }

        const html = await response.text();
        console.log('[Facebook Fetch] HTML length:', html.length);

        const postData = extractPostData(html);
        console.log('[Facebook Fetch] Extracted data:', {
            textLength: postData.text?.length || 0,
            imagesCount: postData.images.length,
            author: postData.author,
        });

        // If extraction fails, still return success but allow manual input
        if (!postData.text && postData.images.length === 0) {
            console.log('[Facebook Fetch] No content extracted, allowing manual input');
            return NextResponse.json({
                success: true,
                data: {
                    text: '',
                    images: [],
                    author: undefined,
                },
                message: 'Could not extract content automatically. Please enter the content manually.'
            });
        }

        return NextResponse.json({
            success: true,
            data: postData
        });

    } catch (error) {
        console.error('[Facebook Fetch] Error:', error);
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
        const imageUrl = match[1];
        // Filter out profile pics and icons
        if (imageUrl && !imageUrl.includes('profile') && !imageUrl.includes('icon')) {
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
            if (jsonData.articleBody) {
                data.text = jsonData.articleBody;
            } else if (jsonData.description) {
                data.text = jsonData.description;
            }
            if (jsonData.author?.name) {
                data.author = jsonData.author.name;
            }
            if (jsonData.image) {
                const images = Array.isArray(jsonData.image) ? jsonData.image : [jsonData.image];
                data.images.push(...images);
            }
        } catch {
            // JSON parse failed, continue with other methods
        }
    }

    // Method 3: Look for data-content-id patterns (Facebook's internal structure)
    const contentMatches = html.matchAll(/data-content-type="[^"]*"[^>]*>([^<]+)</gi);
    for (const match of contentMatches) {
        const content = match[1].trim();
        if (content.length > 20 && !data.text) {
            data.text = decodeHtmlEntities(content);
        }
    }

    // Method 4: Extract image URLs from various patterns
    const imgMatches = html.matchAll(/src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of imgMatches) {
        const imageUrl = match[1];
        // Filter out small images, emojis, etc
        if (imageUrl &&
            !imageUrl.includes('emoji') &&
            !imageUrl.includes('icon') &&
            !imageUrl.includes('like') &&
            !imageUrl.includes('comment') &&
            !data.images.includes(imageUrl)) {
            data.images.push(imageUrl);
        }
    }

    // Limit to first 5 images
    data.images = data.images.slice(0, 5);

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
