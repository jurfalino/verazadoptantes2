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
    error?: string;
}

async function scrapeFacebookPost(url: string): Promise<ScrapeResult> {
    let browser: Browser | null = null;

    // Detect video/reel URLs — these need different extraction strategy
    const isVideoUrl = /\/(reel|r|share\/r)\//.test(url) || /\/videos\//.test(url);

    try {
        console.log(`[Scraper] Starting scrape for: ${url} (isVideo: ${isVideoUrl})`);

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

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
        // Facebook now shows a login wall overlay on public group posts — content is behind it
        try {
            // Strategy 1: Click close button on the login modal
            const closeSelectors = [
                'div[role="dialog"] div[aria-label="Close"]',
                'div[role="dialog"] div[aria-label="Cerrar"]',
                'div[role="dialog"] [aria-label="Close"]',
                'div[role="dialog"] [aria-label="Cerrar"]',
            ];
            let dismissed = false;
            for (const sel of closeSelectors) {
                const closeBtn = await page.$(sel);
                if (closeBtn) {
                    await closeBtn.click();
                    console.log(`[Scraper] Dismissed login modal via: ${sel}`);
                    dismissed = true;
                    await page.waitForTimeout(1000);
                    break;
                }
            }

            // Strategy 2: Press Escape to close any modal
            if (!dismissed) {
                await page.keyboard.press('Escape');
                console.log('[Scraper] Pressed Escape to dismiss modal');
                await page.waitForTimeout(1000);
            }

            // Strategy 3: Remove login overlay from DOM so we can access content behind it
            await page.evaluate(() => {
                // Remove login modals/overlays
                document.querySelectorAll('div[role="dialog"]').forEach(el => el.remove());
                // Remove backdrop/overlay
                document.querySelectorAll('div[data-visualcompletion="ignore"]').forEach(el => {
                    if (el instanceof HTMLElement && el.style.position === 'fixed') el.remove();
                });
            });
        } catch (e) {
            console.log('[Scraper] Login modal dismissal error (may not be present):', e instanceof Error ? e.message : e);
        }

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

        // Try to get post text from various selectors
        const textSelectors = [
            'div[data-ad-preview="message"]',
            'div[data-ad-comet-preview="message"]',
            'div[dir="auto"]',
        ];

        // For video posts, accept shorter text (reel captions are often brief)
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

        // Try to get author name
        const authorSelectors = [
            'h2 a strong',
            'span a strong',
            'h4 a',
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

        // Extract images from <img> elements with 'scontent' in src (Facebook CDN)
        const images: string[] = [];
        const imgElements = await page.$$('img');

        for (const img of imgElements) {
            const src = await img.getAttribute('src');
            if (src && src.includes('scontent')) {
                // Filter out small images (profile pics, icons)
                const width = await img.getAttribute('width');
                const height = await img.getAttribute('height');

                // Skip tiny images
                if (width && parseInt(width) < 50) continue;
                if (height && parseInt(height) < 50) continue;

                // Skip profile pictures and emojis
                if (src.includes('_s.') || src.includes('_t.') || src.includes('emoji')) continue;

                // Deduplicate
                if (!images.includes(src)) {
                    images.push(src);
                }
            }
        }

        // For video posts: also look for video poster/thumbnail images
        if (isVideoUrl || images.length === 0) {
            // Check <video> poster attributes
            const videoElements = await page.$$('video');
            for (const video of videoElements) {
                const poster = await video.getAttribute('poster');
                if (poster && !images.includes(poster)) {
                    images.push(poster);
                }
            }

            // Check for lookaside CDN images (common for video thumbnails)
            const allImgs = await page.$$('img');
            for (const img of allImgs) {
                const src = await img.getAttribute('src');
                if (src && src.includes('lookaside') && !images.includes(src)) {
                    images.push(src);
                }
            }
        }

        // Fallback: fetch raw HTML with facebookexternalhit UA
        // Facebook strips OG tags from the rendered DOM (login wall),
        // but ALWAYS serves them via plain HTTP to its own crawler UA
        if (!text || images.length === 0) {
            console.log('[Scraper] DOM extraction sparse, trying HTTP fetch with facebookexternalhit UA...');
            try {
                const ogResponse = await fetch(url, {
                    headers: {
                        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                        'Accept': 'text/html',
                    },
                    redirect: 'follow',
                });

                if (ogResponse.ok) {
                    const rawHtml = await ogResponse.text();

                    // OG title → author
                    if (!author) {
                        const ogTitle = rawHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
                        if (ogTitle) {
                            author = ogTitle[1]
                                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
                                .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
                        }
                    }

                    // OG description → text
                    if (!text) {
                        const ogDesc = rawHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
                        if (ogDesc) {
                            text = ogDesc[1]
                                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
                                .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
                        }
                    }

                    // OG image → images
                    if (images.length === 0) {
                        const ogImageMatches = rawHtml.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi);
                        for (const match of ogImageMatches) {
                            let imgUrl = match[1]
                                .replace(/&amp;/g, '&');
                            if (!images.includes(imgUrl)) {
                                images.push(imgUrl);
                            }
                        }
                    }
                }
            } catch (fetchErr) {
                console.error('[Scraper] HTTP OG fallback failed:', fetchErr);
            }

            console.log(`[Scraper] OG fallback: author="${author}", text="${text.substring(0, 50)}", images=${images.length}`);
        }

        console.log(`[Scraper] Found ${images.length} images, text length: ${text.length}, author: "${author}"`);

        await browser.close();

        return {
            text: text.trim(),
            author: author.trim() || undefined,
            images
        };

    } catch (error) {
        console.error('[Scraper] Error:', error);
        if (browser) await browser.close();

        return {
            text: '',
            images: [],
            error: error instanceof Error ? error.message : 'Scraping failed'
        };
    }
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main scrape endpoint
app.post('/scrape', async (req: Request, res: Response) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Validate Facebook URL
    const fbPattern = /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i;
    if (!fbPattern.test(url)) {
        return res.status(400).json({ error: 'Invalid Facebook URL' });
    }

    try {
        const result = await scrapeFacebookPost(url);

        if (result.error) {
            return res.status(500).json({ success: false, error: result.error });
        }

        res.json({
            success: true,
            data: {
                text: result.text,
                author: result.author,
                images: result.images
            }
        });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to scrape post'
        });
    }
});

app.listen(PORT, () => {
    console.log(`[Scraper] Server running on port ${PORT}`);
});
