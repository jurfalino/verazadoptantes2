import express, { Request, Response } from 'express';
import cors from 'cors';
import { chromium, Browser, Page } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;

app.use(cors());
app.use(express.json());

// Optional API key authentication
app.use((req, res, next) => {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
});

interface ScrapeResult {
    text: string;
    author?: string;
    images: string[];
    videos: string[];
    platform: string;
    error?: string;
}

// ─── Platform Detection ─────────────────────────────────────────────────────

type Platform = 'facebook' | 'instagram' | 'twitter' | 'tiktok' | 'unknown';

function detectPlatform(url: string): Platform {
    const lower = url.toLowerCase();
    if (/facebook\.com|fb\.com|fb\.watch/.test(lower)) return 'facebook';
    if (/instagram\.com|instagr\.am/.test(lower)) return 'instagram';
    if (/twitter\.com|x\.com|t\.co/.test(lower)) return 'twitter';
    if (/tiktok\.com/.test(lower)) return 'tiktok';
    return 'unknown';
}

// Supported social networks for URL validation
const SUPPORTED_PLATFORMS: Platform[] = ['facebook', 'instagram', 'twitter', 'tiktok'];

// ─── Shared Browser Helpers ─────────────────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
    return chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
}

async function dismissModals(page: Page): Promise<void> {
    try {
        // Strategy 1: Click close button on dialogs
        const closeSelectors = [
            'div[role="dialog"] div[aria-label="Close"]',
            'div[role="dialog"] div[aria-label="Cerrar"]',
            'div[role="dialog"] [aria-label="Close"]',
            'div[role="dialog"] [aria-label="Cerrar"]',
            'button[aria-label="Close"]',
            'button[aria-label="Cerrar"]',
        ];
        let dismissed = false;
        for (const sel of closeSelectors) {
            const closeBtn = await page.$(sel);
            if (closeBtn) {
                await closeBtn.click();
                console.log(`[Scraper] Dismissed modal via: ${sel}`);
                dismissed = true;
                await page.waitForTimeout(1000);
                break;
            }
        }

        // Strategy 2: Press Escape
        if (!dismissed) {
            await page.keyboard.press('Escape');
            console.log('[Scraper] Pressed Escape to dismiss modal');
            await page.waitForTimeout(1000);
        }

        // Strategy 3: Remove overlay elements from DOM
        await page.evaluate(() => {
            document.querySelectorAll('div[role="dialog"]').forEach(el => el.remove());
            document.querySelectorAll('div[data-visualcompletion="ignore"]').forEach(el => {
                if (el instanceof HTMLElement && el.style.position === 'fixed') el.remove();
            });
        });
    } catch (e) {
        console.log('[Scraper] Modal dismissal (may not be present):', e instanceof Error ? e.message : e);
    }
}

/** Extract OG tags from a Playwright page */
async function extractOgTags(page: Page): Promise<{ title?: string; description?: string; images: string[]; videos: string[] }> {
    return page.evaluate(() => {
        const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || undefined;
        const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || undefined;
        const images = Array.from(document.querySelectorAll('meta[property="og:image"]'))
            .map(el => el.getAttribute('content'))
            .filter(Boolean) as string[];
        const videos = Array.from(document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"]'))
            .map(el => el.getAttribute('content'))
            .filter(Boolean) as string[];
        return { title, description, images, videos };
    });
}

/** Fetch OG tags via HTTP with a bot User-Agent (no Playwright needed) */
/** Stable-ish id for an Instagram CDN image URL, so size variants of the same
 *  photo dedupe to one while distinct carousel slides stay separate. Keys on the
 *  first two id groups (`<photoId>_<mediaId>`), which are identical across the
 *  og:image (scontent host) and the image_versions2 (fbcdn host) URLs of the same
 *  slide — so the cover doesn't get counted twice — yet unique per slide. */
function instagramImageId(u: string): string {
    const m = u.match(/\/([0-9]{6,}_[0-9]{6,})_[0-9]/);
    return m ? m[1] : u.split('?')[0];
}

/**
 * Harvest ALL Instagram carousel image URLs from page HTML/JSON and append the
 * new ones to `out`. Instagram exposes only ONE `og:image` (the cover) even for
 * multi-photo carousels, but embeds every slide in the Relay preload JSON under
 * `image_versions2.candidates[].url` (the first candidate is the full-res one).
 * Only the PRIMARY post emits these blocks — suggested/related posts on the page
 * are just references — so this stays scoped to the target post's slides.
 *
 * (History: Instagram retired the old `display_url` field this used to read, which
 * is why multi-image posts silently returned only the cover. Feed images carry a
 * `t51.<n>-15` path segment; `-19` is profile pics, which we skip.) Dedupes by
 * image id so the cover (already in `out` from og:image) isn't double-counted.
 * Escaped JSON slashes/ampersands are unescaped. Best-effort — markup evolves.
 */
function harvestInstagramImages(html: string, out: string[]): void {
    const seen = new Set(out.map(instagramImageId));
    const consider = (raw: string) => {
        const u = raw
            .replace(/\\u0026/gi, '&')
            .replace(/\\u00253D/gi, '%3D')
            .replace(/\\\//g, '/');
        if (!/scontent|cdninstagram|fbcdn/i.test(u)) return;
        // Skip thumbnails, profile pics, emoji, and non-feed image classes.
        if (/(_s\.|_t\.|s150x150|150x150|\/profile|profile_pic|emoji|t51\.[0-9]+-19)/i.test(u)) return;
        const id = instagramImageId(u);
        if (seen.has(id)) return;
        seen.add(id);
        out.push(u);
    };
    // Primary source: the current image_versions2 structure (first candidate = full-res).
    for (const m of html.matchAll(/"image_versions2":\{"candidates":\[\{"url":"([^"]+)"/g)) consider(m[1]);
    // Legacy fallback for older markup that still exposes display_url.
    for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) consider(m[1]);
}

async function fetchOgTagsHttp(url: string, userAgent: string): Promise<{ title?: string; description?: string; images: string[]; videos: string[]; text?: string }> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
            },
            redirect: 'follow',
        });
        if (!response.ok) return { images: [], videos: [] };

        const html = await response.text();

        const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        const imageMatches = [...html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi)];
        const videoMatches = [...html.matchAll(/<meta\s+property="og:video(?::url)?"\s+content="([^"]+)"/gi)];

        // Also try JSON-LD
        let jsonLdText = '';
        const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
            try {
                const ld = JSON.parse(jsonLdMatch[1]) as {
                    articleBody?: string;
                    description?: string;
                    name?: string;
                };
                jsonLdText = ld.articleBody || ld.description || '';
            } catch { /* ignore */ }
        }

        const decodeEntities = (s: string) => s
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

        const images = imageMatches.map(m => decodeEntities(m[1]));
        // Instagram carousels: og:image is just the cover — harvest the rest of
        // the slides from the embedded JSON so multi-image posts return them all.
        if (/instagram\.com|instagr\.am/.test(url)) harvestInstagramImages(html, images);

        return {
            title: titleMatch ? decodeEntities(titleMatch[1]) : undefined,
            description: descMatch ? decodeEntities(descMatch[1]) : undefined,
            text: jsonLdText || undefined,
            images,
            videos: videoMatches.map(m => decodeEntities(m[1])),
        };
    } catch (e) {
        console.error(`[Scraper] HTTP OG fetch failed for ${url}:`, e instanceof Error ? e.message : e);
        return { images: [], videos: [] };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// FACEBOOK SCRAPER (existing, proven logic — unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeFacebookPost(url: string): Promise<ScrapeResult> {
    let browser: Browser | null = null;

    // Detect video/reel URLs — these need different extraction strategy
    const isVideoUrl = /\/(reel|r|share\/r)\//.test(url) || /\/videos\//.test(url);

    try {
        console.log(`[Scraper] Starting Facebook scrape for: ${url} (isVideo: ${isVideoUrl})`);

        browser = await launchBrowser();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            locale: 'es-AR',
            timezoneId: 'America/Argentina/Buenos_Aires',
        });

        const page: Page = await context.newPage();

        // Navigate to the URL
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // Dismiss cookie consent dialog if present
        try {
            const cookieBtn = await page.$('button[data-cookiebanner="accept_button"], button[data-testid="cookie-policy-manage-dialog-accept-button"]');
            if (cookieBtn) {
                await cookieBtn.click();
                console.log('[Scraper] Dismissed cookie consent');
                await page.waitForTimeout(1000);
            }
        } catch { /* no cookie dialog */ }

        // Dismiss Facebook login modal/overlay if present
        await dismissModals(page);

        // Wait for content to load - Facebook posts are in article elements
        try {
            await page.waitForSelector('div[role="article"]', { timeout: 10000 });
        } catch {
            // Try alternative selectors
            await page.waitForTimeout(3000);
        }

        // Extra wait for images to load
        await page.waitForTimeout(2000);

        // Log page state for debugging
        const pageTitle = await page.title();
        const articleCount = await page.$$eval('div[role="article"]', els => els.length);
        console.log(`[Scraper] Page title: "${pageTitle}", articles found: ${articleCount}`);

        // Extract text content
        let text = '';
        let author = '';

        // Method 1: Extract OG tags directly from the DOM (most reliable)
        try {
            const ogTitle = await page.$eval('meta[property="og:title"]',
                el => el.getAttribute('content')
            ).catch(() => null);
            const ogDesc = await page.$eval('meta[property="og:description"]',
                el => el.getAttribute('content')
            ).catch(() => null);

            if (ogTitle) {
                const parts = ogTitle.split('|').map((s: string) => s.trim());
                if (parts.length > 1) {
                    author = parts[0];
                }
            }
            if (ogDesc) {
                text = ogDesc;
            }
        } catch { /* no OG tags */ }

        // Method 2: Extract from article elements (full post text)
        const articles = await page.$$('div[role="article"]');
        for (const article of articles) {
            const content = await article.textContent();
            if (content && content.length > text.length && content.length > 20) {
                text = content;
            }
        }

        // Method 3: Try traditional selectors as fallback
        if (!text) {
            const textSelectors = [
                'div[data-ad-preview="message"]',
                'div[data-ad-comet-preview="message"]',
                'div[dir="auto"]',
            ];

            const minTextLength = isVideoUrl ? 5 : 50;

            for (const selector of textSelectors) {
                const elements = await page.$$(selector);
                for (const el of elements) {
                    const content = await el.textContent();
                    if (content && content.length > text.length && content.length > minTextLength) {
                        text = content;
                    }
                }
            }
        }

        // Try to get author name (if not already from OG tags)
        if (!author) {
            const authorSelectors = [
                'h2 a strong',
                'h3 a strong',
                'span a strong',
                'h4 a',
                'h2 a',
            ];

            for (const selector of authorSelectors) {
                const authorEl = await page.$(selector);
                if (authorEl) {
                    const name = await authorEl.textContent();
                    if (name && name.length > 0 && name.length < 100) {
                        author = name;
                        break;
                    }
                }
            }
        }

        // Extract images — try OG first, then scontent img elements
        const images: string[] = [];

        // Method 1: OG meta images from the DOM (most reliable)
        try {
            const ogImages = await page.$$eval('meta[property="og:image"]',
                els => els.map(el => el.getAttribute('content')).filter(Boolean) as string[]
            );
            for (const imgUrl of ogImages) {
                if (!images.includes(imgUrl)) {
                    images.push(imgUrl);
                }
            }
        } catch { /* no OG images */ }

        // Method 2: scontent img elements from the rendered page
        const imgElements = await page.$$('img');

        for (const img of imgElements) {
            const src = await img.getAttribute('src');
            if (src && src.includes('scontent')) {
                const width = await img.getAttribute('width');
                const height = await img.getAttribute('height');
                if (width && parseInt(width) < 50) continue;
                if (height && parseInt(height) < 50) continue;
                if (src.includes('_s.') || src.includes('_t.') || src.includes('emoji')) continue;
                if (!images.includes(src)) {
                    images.push(src);
                }
            }
        }

        // For video posts: also look for video poster/thumbnail images
        if (isVideoUrl || images.length === 0) {
            const videoElements = await page.$$('video');
            for (const video of videoElements) {
                const poster = await video.getAttribute('poster');
                if (poster && !images.includes(poster)) {
                    images.push(poster);
                }
            }

            const allImgs = await page.$$('img');
            for (const img of allImgs) {
                const src = await img.getAttribute('src');
                if (src && src.includes('lookaside') && !images.includes(src)) {
                    images.push(src);
                }
            }
        }

        // Fallback: fetch raw HTML with facebookexternalhit UA
        if (!text || images.length === 0) {
            console.log('[Scraper] DOM extraction sparse, trying HTTP fetch with facebookexternalhit UA...');
            const ogData = await fetchOgTagsHttp(url, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
            if (!author && ogData.title) {
                author = ogData.title.replace(/&amp;/g, '&');
            }
            if (!text && ogData.description) {
                text = ogData.description;
            }
            if (images.length === 0) {
                for (const img of ogData.images) {
                    if (!images.includes(img)) images.push(img);
                }
            }
            console.log(`[Scraper] OG fallback: author="${author}", text="${text.substring(0, 50)}", images=${images.length}`);
        }

        console.log(`[Scraper] Found ${images.length} images, text length: ${text.length}, author: "${author}"`);

        await browser.close();

        return {
            text: text.trim(),
            author: author.trim() || undefined,
            images,
            videos: [],
            platform: 'facebook',
        };

    } catch (error) {
        console.error('[Scraper] Facebook error:', error);
        if (browser) await browser.close();

        return {
            text: '',
            images: [],
            videos: [],
            platform: 'facebook',
            error: error instanceof Error ? error.message : 'Scraping failed'
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// INSTAGRAM SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeInstagramPost(url: string): Promise<ScrapeResult> {
    let browser: Browser | null = null;

    try {
        console.log(`[Scraper] Starting Instagram scrape for: ${url}`);

        // Step 1: Try HTTP OG fetch first (fast, no browser needed)
        // Instagram serves OG tags to certain bots
        const ogData = await fetchOgTagsHttp(url, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

        let text = ogData.description || ogData.text || '';
        let author = ogData.title || '';
        const images: string[] = [...ogData.images];
        const videos: string[] = [...(ogData.videos || [])];

        // Clean up Instagram OG title (usually "Author on Instagram: 'caption...'")
        if (author) {
            const igAuthorMatch = author.match(/^(.+?)\s+on\s+Instagram/i)
                || author.match(/^(.+?)\s+en\s+Instagram/i)
                || author.match(/^(.+?)\s*[@|]/);
            if (igAuthorMatch) {
                author = igAuthorMatch[1].trim();
            }
        }

        // If we got good data from OG, we can skip Playwright
        if (text.length > 30 && images.length > 0) {
            console.log(`[Scraper] Instagram OG extraction success: text=${text.length}, images=${images.length}`);
            return {
                text: text.trim(),
                author: author.trim() || undefined,
                images: images.slice(0, 20),
                videos: videos.slice(0, 5),
                platform: 'instagram',
            };
        }

        // Step 2: Playwright fallback for when OG tags are insufficient
        console.log('[Scraper] Instagram OG insufficient, launching Playwright...');
        browser = await launchBrowser();

        const context = await browser.newContext({
            // Use mobile viewport — Instagram serves a lighter page to mobile
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            viewport: { width: 390, height: 844 },
            locale: 'es-AR',
            isMobile: true,
        });

        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Dismiss login prompts
        await dismissModals(page);

        // Try to extract OG tags from the rendered page
        const pageOg = await extractOgTags(page);
        if (!text && pageOg.description) text = pageOg.description;
        if (!author && pageOg.title) {
            author = pageOg.title;
            const igMatch = author.match(/^(.+?)\s+on\s+Instagram/i) || author.match(/^(.+?)\s+en\s+Instagram/i);
            if (igMatch) author = igMatch[1].trim();
        }
        for (const img of pageOg.images) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of pageOg.videos) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        // Extract text from article or main content
        const articleText = await page.evaluate(() => {
            // Try article elements
            const article = document.querySelector('article');
            if (article) {
                // Get spans within article with text content
                const spans = article.querySelectorAll('span');
                let longest = '';
                spans.forEach(s => {
                    const t = s.textContent || '';
                    if (t.length > longest.length && t.length > 10) longest = t;
                });
                return longest;
            }
            return '';
        });

        if (articleText && articleText.length > text.length) {
            text = articleText;
        }

        // Extract images from rendered page
        const pageImages = await page.evaluate(() => {
            const imgs: string[] = [];
            document.querySelectorAll('img').forEach(img => {
                const src = img.src;
                if (src && (src.includes('cdninstagram') || src.includes('scontent') || src.includes('fbcdn'))) {
                    // Filter out tiny images (profile pics, icons)
                    const w = img.naturalWidth || img.width || 0;
                    const h = img.naturalHeight || img.height || 0;
                    if (w > 100 || h > 100 || (!w && !h)) {
                        if (!src.includes('profile') && !src.includes('150x150') && !src.includes('s150x150')) {
                            imgs.push(src);
                        }
                    }
                }
            });
            return imgs;
        });

        for (const img of pageImages) {
            if (!images.includes(img)) images.push(img);
        }

        // Carousels: only the first slide renders as an <img> (lazy-loaded), so
        // harvest every slide's URL from the rendered page's embedded JSON.
        try { harvestInstagramImages(await page.content(), images); } catch { /* best-effort */ }

        // Extract video thumbnails and video source URLs
        const videoData = await page.evaluate(() => {
            const posters: string[] = [];
            const srcs: string[] = [];
            document.querySelectorAll('video').forEach(v => {
                if (v.poster) posters.push(v.poster);
                if (v.src) srcs.push(v.src);
                // Check source elements inside video
                v.querySelectorAll('source').forEach(s => {
                    if (s.src) srcs.push(s.src);
                });
            });
            return { posters, srcs };
        });

        for (const img of videoData.posters) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of videoData.srcs) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        console.log(`[Scraper] Instagram result: text=${text.length}, author="${author}", images=${images.length}`);

        await browser.close();

        return {
            text: text.trim(),
            author: author.trim() || undefined,
            images: images.slice(0, 10),
            videos: videos.slice(0, 5),
            platform: 'instagram',
        };

    } catch (error) {
        console.error('[Scraper] Instagram error:', error);
        if (browser) await browser.close();
        return {
            text: '',
            images: [],
            videos: [],
            platform: 'instagram',
            error: error instanceof Error ? error.message : 'Instagram scraping failed'
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// TWITTER / X SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeTwitterPost(url: string): Promise<ScrapeResult> {
    let browser: Browser | null = null;

    try {
        console.log(`[Scraper] Starting Twitter/X scrape for: ${url}`);

        // Step 1: Use vxtwitter.com / fxtwitter.com proxy (most reliable)
        // These services rewrite Twitter URLs to serve full OG tags
        const vxUrl = url
            .replace(/\/(twitter|x)\.com\//i, '/vxtwitter.com/')
            .replace(/\?.*$/, ''); // strip query params

        console.log(`[Scraper] Trying vxtwitter proxy: ${vxUrl}`);
        const vxData = await fetchOgTagsHttp(vxUrl, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

        let text = vxData.description || vxData.text || '';
        let author = vxData.title || '';
        const images: string[] = [...vxData.images];
        const videos: string[] = [...(vxData.videos || [])];

        // Clean up author — vxtwitter title is usually "Author (@handle)"
        if (author) {
            const handleMatch = author.match(/^(.+?)\s*\(@/);
            if (handleMatch) author = handleMatch[1].trim();
        }

        if (text.length > 10 || images.length > 0) {
            console.log(`[Scraper] vxtwitter success: text=${text.length}, images=${images.length}`);
            return {
                text: text.trim(),
                author: author.trim() || undefined,
                images: images.slice(0, 10),
                videos: videos.slice(0, 5),
                platform: 'twitter',
            };
        }

        // Step 2: Try fxtwitter as backup
        const fxUrl = url
            .replace(/\/(twitter|x)\.com\//i, '/fxtwitter.com/')
            .replace(/\?.*$/, '');

        console.log(`[Scraper] Trying fxtwitter proxy: ${fxUrl}`);
        const fxData = await fetchOgTagsHttp(fxUrl, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

        if (fxData.description) text = fxData.description;
        if (fxData.title && !author) {
            author = fxData.title;
            const handleMatch = author.match(/^(.+?)\s*\(@/);
            if (handleMatch) author = handleMatch[1].trim();
        }
        for (const img of fxData.images) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of (fxData.videos || [])) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        if (text.length > 10 || images.length > 0) {
            console.log(`[Scraper] fxtwitter success: text=${text.length}, images=${images.length}`);
            return {
                text: text.trim(),
                author: author.trim() || undefined,
                images: images.slice(0, 10),
                videos: videos.slice(0, 5),
                platform: 'twitter',
            };
        }

        // Step 3: Playwright fallback (last resort — X is aggressive with bot detection)
        console.log('[Scraper] Proxy methods failed, launching Playwright for X...');
        browser = await launchBrowser();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            locale: 'es-AR',
        });

        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        // Dismiss login prompts
        await dismissModals(page);

        // Extract OG tags
        const pageOg = await extractOgTags(page);
        if (!text && pageOg.description) text = pageOg.description;
        if (!author && pageOg.title) author = pageOg.title;
        for (const img of pageOg.images) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of pageOg.videos) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        // Try to get tweet text from the page
        const tweetText = await page.evaluate(() => {
            // Twitter/X uses article[data-testid="tweet"] or div[data-testid="tweetText"]
            const tweetEl = document.querySelector('[data-testid="tweetText"]');
            if (tweetEl) return tweetEl.textContent || '';
            // Fallback: largest text block in an article
            const article = document.querySelector('article');
            if (article) return article.textContent || '';
            return '';
        });

        if (tweetText && tweetText.length > text.length) {
            text = tweetText;
        }

        // Extract images from tweet
        const tweetImages = await page.evaluate(() => {
            const imgs: string[] = [];
            // Twitter image URLs contain pbs.twimg.com
            document.querySelectorAll('img').forEach(img => {
                const src = img.src;
                if (src && src.includes('twimg.com/media')) {
                    imgs.push(src);
                }
            });
            return imgs;
        });

        for (const img of tweetImages) {
            if (!images.includes(img)) images.push(img);
        }

        console.log(`[Scraper] Twitter result: text=${text.length}, author="${author}", images=${images.length}`);

        await browser.close();

        return {
            text: text.trim(),
            author: author.trim() || undefined,
            images: images.slice(0, 10),
            videos: videos.slice(0, 5),
            platform: 'twitter',
        };

    } catch (error) {
        console.error('[Scraper] Twitter error:', error);
        if (browser) await browser.close();
        return {
            text: '',
            images: [],
            videos: [],
            platform: 'twitter',
            error: error instanceof Error ? error.message : 'Twitter scraping failed'
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// TIKTOK SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeTikTokPost(url: string): Promise<ScrapeResult> {
    let browser: Browser | null = null;

    try {
        console.log(`[Scraper] Starting TikTok scrape for: ${url}`);

        // Step 1: Try HTTP OG fetch — TikTok typically serves OG tags
        const ogData = await fetchOgTagsHttp(url, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

        let text = ogData.description || ogData.text || '';
        let author = ogData.title || '';
        const images: string[] = [...ogData.images];
        const videos: string[] = [...(ogData.videos || [])];

        // Clean up title — TikTok format: "Author on TikTok"
        if (author) {
            const ttMatch = author.match(/^(.+?)(?:\s+on\s+TikTok|\s+-\s+TikTok|'s?)/i);
            if (ttMatch) author = ttMatch[1].trim();
        }

        if (text.length > 10 || images.length > 0) {
            console.log(`[Scraper] TikTok OG success: text=${text.length}, images=${images.length}`);
            return {
                text: text.trim(),
                author: author.trim() || undefined,
                images: images.slice(0, 10),
                videos: videos.slice(0, 5),
                platform: 'tiktok',
            };
        }

        // Step 2: Playwright fallback
        console.log('[Scraper] TikTok OG insufficient, launching Playwright...');
        browser = await launchBrowser();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            locale: 'es-AR',
        });

        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        // Dismiss any modals
        await dismissModals(page);

        // Extract OG tags from rendered page
        const pageOg = await extractOgTags(page);
        if (!text && pageOg.description) text = pageOg.description;
        if (!author && pageOg.title) author = pageOg.title;
        for (const img of pageOg.images) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of pageOg.videos) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        // Try to get description from page content
        const pageText = await page.evaluate(() => {
            // TikTok video descriptions
            const descEl = document.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
            if (descEl) return descEl.textContent || '';
            return '';
        });

        if (pageText && pageText.length > text.length) {
            text = pageText;
        }

        // Extract video poster images and video source URLs
        const videoData = await page.evaluate(() => {
            const posters: string[] = [];
            const srcs: string[] = [];
            document.querySelectorAll('video').forEach(v => {
                if (v.poster) posters.push(v.poster);
                if (v.src) srcs.push(v.src);
                v.querySelectorAll('source').forEach(s => {
                    if (s.src) srcs.push(s.src);
                });
            });
            // Also check for large cover images
            document.querySelectorAll('img').forEach(img => {
                const src = img.src;
                if (src && (src.includes('tiktokcdn') || src.includes('tiktokv.com')) && img.width > 200) {
                    posters.push(src);
                }
            });
            return { posters, srcs };
        });

        for (const img of videoData.posters) {
            if (!images.includes(img)) images.push(img);
        }
        for (const vid of videoData.srcs) {
            if (!videos.includes(vid)) videos.push(vid);
        }

        console.log(`[Scraper] TikTok result: text=${text.length}, author="${author}", images=${images.length}`);

        await browser.close();

        return {
            text: text.trim(),
            author: author.trim() || undefined,
            images: images.slice(0, 10),
            videos: videos.slice(0, 5),
            platform: 'tiktok',
        };

    } catch (error) {
        console.error('[Scraper] TikTok error:', error);
        if (browser) await browser.close();
        return {
            text: '',
            images: [],
            videos: [],
            platform: 'tiktok',
            error: error instanceof Error ? error.message : 'TikTok scraping failed'
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// GENERIC SCRAPER (unknown platforms)
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeGenericPost(url: string): Promise<ScrapeResult> {
    try {
        console.log(`[Scraper] Starting generic scrape for: ${url}`);
        const ogData = await fetchOgTagsHttp(url, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
        return {
            text: (ogData.description || ogData.text || '').trim(),
            author: ogData.title?.trim() || undefined,
            images: ogData.images.slice(0, 10),
            videos: (ogData.videos || []).slice(0, 5),
            platform: 'unknown',
        };
    } catch (error) {
        console.error('[Scraper] Generic error:', error);
        return {
            text: '',
            images: [],
            videos: [],
            platform: 'unknown',
            error: error instanceof Error ? error.message : 'Scraping failed'
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapePost(url: string): Promise<ScrapeResult> {
    const platform = detectPlatform(url);
    console.log(`[Scraper] Detected platform: ${platform} for URL: ${url}`);

    switch (platform) {
        case 'facebook': return scrapeFacebookPost(url);
        case 'instagram': return scrapeInstagramPost(url);
        case 'twitter': return scrapeTwitterPost(url);
        case 'tiktok': return scrapeTikTokPost(url);
        default: return scrapeGenericPost(url);
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        supportedPlatforms: SUPPORTED_PLATFORMS,
    });
});

// Main scrape endpoint — accepts any supported social media URL
app.post('/scrape', async (req: Request, res: Response) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const platform = detectPlatform(url);

    // Validate it's a supported URL
    if (platform === 'unknown') {
        return res.status(400).json({
            error: 'Unsupported URL. Supported platforms: Facebook, Instagram, X/Twitter, TikTok',
            detectedPlatform: platform,
        });
    }

    try {
        const result = await scrapePost(url);

        if (result.error) {
            return res.status(500).json({
                success: false,
                error: result.error,
                platform,
            });
        }

        res.json({
            success: true,
            data: {
                text: result.text,
                author: result.author,
                images: result.images,
                videos: result.videos,
            },
            platform,
        });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to scrape post',
            platform,
        });
    }
});

app.listen(PORT, () => {
    console.log(`[Scraper] Server running on port ${PORT}`);
    console.log(`[Scraper] Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
});
