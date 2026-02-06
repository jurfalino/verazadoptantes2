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

    try {
        console.log(`[Scraper] Starting scrape for: ${url}`);

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });

        const page: Page = await context.newPage();

        // Navigate to the URL
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // Wait for content to load - Facebook posts are in article elements
        try {
            await page.waitForSelector('div[role="article"]', { timeout: 10000 });
        } catch {
            // Try alternative selectors
            await page.waitForTimeout(3000);
        }

        // Extra wait for images to load
        await page.waitForTimeout(2000);

        // Extract text content
        let text = '';
        let author = '';

        // Try to get post text from various selectors
        const textSelectors = [
            'div[data-ad-preview="message"]',
            'div[data-ad-comet-preview="message"]',
            'div[dir="auto"]',
        ];

        for (const selector of textSelectors) {
            const elements = await page.$$(selector);
            for (const el of elements) {
                const content = await el.textContent();
                if (content && content.length > text.length && content.length > 50) {
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

        // Extract all images with 'scontent' in src (Facebook CDN)
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

        console.log(`[Scraper] Found ${images.length} images, text length: ${text.length}`);

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
