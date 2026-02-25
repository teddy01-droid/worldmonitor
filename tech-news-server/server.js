/**
 * Tech News API Server — Gemini AI-Powered Processor
 * 
 * Endpoints:
 *   GET /api/tech-news              → Raw RSS feed items
 *   GET /api/tech-news/generate     → AI-processed articles (Gemini)
 *   GET /health                     → Health check
 * 
 * Environment:
 *   GEMINI_API_KEY  — Required for /generate endpoint
 *   PORT            — Server port (default 3000)
 * 
 * Patterns ported from World Monitor:
 *   - Prompt engineering from server/worldmonitor/news/v1/_shared.ts
 *   - Reasoning preamble stripping from summarize-article.ts
 *   - SVG brand card generation from api/og-story.js
 *   - Headline deduplication from dedup.mjs
 */

import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ── RSS Feed Sources ────────────────────────────────────────────────
const FEEDS = [
    { name: 'TechCrunch', key: 'techcrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'The Verge', key: 'verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica', key: 'arstechnica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'Hacker News', key: 'hackernews', url: 'https://hnrss.org/frontpage' },
    { name: 'Wired', key: 'wired', url: 'https://www.wired.com/feed/rss' },
];

// ── Brand Template Config ───────────────────────────────────────────
const BRAND = {
    name: 'TECH PULSE',
    tagline: 'AI-Curated Tech Intelligence',
    colors: {
        primary: '#00d4ff',
        secondary: '#7c3aed',
        accent: '#10b981',
        bg: '#0a0a14',
        bgCard: '#111122',
        text: '#ffffff',
        textMuted: '#888899',
        gradient: ['#00d4ff', '#7c3aed'],
    },
    width: 1200,
    height: 630,
};

// ── Brand Image Prompt Builder (DNA Consistency) ────────────────────

/**
 * Builds a detailed image generation prompt for n8n's Gemini Image node.
 * Enforces DNA brand consistency — every generated image follows the same
 * visual identity: dark tech aesthetic, neon accents, clean minimalist style.
 */
function buildBrandImagePrompt(title, summary, source) {
    // Extract key visual concept from the title
    const topic = title.toLowerCase();
    let visualConcept = 'futuristic technology interface';

    if (topic.includes('ai') || topic.includes('artificial') || topic.includes('machine learning') || topic.includes('neural')) {
        visualConcept = 'neural network nodes glowing with data connections, AI brain visualization';
    } else if (topic.includes('chip') || topic.includes('semiconductor') || topic.includes('processor') || topic.includes('gpu')) {
        visualConcept = 'close-up of a glowing microchip with circuit traces, semiconductor wafer';
    } else if (topic.includes('robot') || topic.includes('autonomous') || topic.includes('self-driving')) {
        visualConcept = 'sleek autonomous robot or self-driving vehicle with sensor beams';
    } else if (topic.includes('space') || topic.includes('rocket') || topic.includes('satellite') || topic.includes('nasa')) {
        visualConcept = 'spacecraft or satellite orbiting Earth with starfield background';
    } else if (topic.includes('phone') || topic.includes('iphone') || topic.includes('android') || topic.includes('mobile')) {
        visualConcept = 'modern smartphone with holographic UI projections';
    } else if (topic.includes('crypto') || topic.includes('blockchain') || topic.includes('bitcoin')) {
        visualConcept = 'blockchain network visualization with floating data blocks';
    } else if (topic.includes('cloud') || topic.includes('server') || topic.includes('data center')) {
        visualConcept = 'futuristic server room with glowing racks and data streams';
    } else if (topic.includes('cyber') || topic.includes('hack') || topic.includes('security') || topic.includes('breach')) {
        visualConcept = 'digital shield or lock with cyber defense grid visualization';
    } else if (topic.includes('startup') || topic.includes('funding') || topic.includes('raised') || topic.includes('billion')) {
        visualConcept = 'abstract growth chart with ascending data particles and innovation symbols';
    } else if (topic.includes('apple') || topic.includes('macbook') || topic.includes('ipad')) {
        visualConcept = 'premium tech device on a sleek dark surface with ambient lighting';
    } else if (topic.includes('google') || topic.includes('search') || topic.includes('meta')) {
        visualConcept = 'interconnected data nodes representing a global tech network';
    } else if (topic.includes('electric') || topic.includes('tesla') || topic.includes('ev') || topic.includes('battery')) {
        visualConcept = 'electric vehicle charging with energy flow visualization';
    }

    return `Create a professional social media post image (1200x630 pixels, landscape format) for a Facebook tech news page.

BRAND IDENTITY (MUST follow exactly):
- Background: Deep dark navy/black gradient (#0a0a14 to #0d0d20)
- Primary accent color: Neon cyan (#00d4ff) for highlights and glows
- Secondary accent: Electric purple (#7c3aed) for depth
- Style: Ultra-modern, clean, minimalist, premium tech aesthetic
- Lighting: Dramatic ambient glow, subtle neon edge lighting
- Mood: Sophisticated, cutting-edge, futuristic

VISUAL CONTENT:
- Main subject: ${visualConcept}
- The image should visually represent: "${title}"
- Add subtle geometric patterns or grid lines in the background (very low opacity)
- Use depth of field — main subject sharp, background softly blurred

STRICT RULES:
- NO text, NO letters, NO words, NO logos, NO watermarks in the image
- NO hands or human faces
- Keep it abstract and conceptual
- Must look professional enough for a premium tech brand
- Color palette MUST use dark backgrounds with cyan and purple neon accents
- Every image must feel like it belongs to the same brand family`;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
    } finally {
        clearTimeout(timeout);
    }
}

function getTag(xml, tag) {
    const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRe);
    if (cdataMatch) return cdataMatch[1].trim();
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(re);
    return match ? match[1].trim() : '';
}

function extractImage(itemXml) {
    const patterns = [
        /<media:content[^>]+url=["']([^"']+)["']/i,
        /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
        /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/i,
        /<enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp|gif))[^"']*["']/i,
    ];
    for (const re of patterns) {
        const m = itemXml.match(re);
        if (m) return m[1];
    }
    const desc = getTag(itemXml, 'description') || getTag(itemXml, 'content:encoded');
    const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
    return null;
}

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
        .replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
        .replace(/\s+/g, ' ').trim();
}

function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Text Similarity (for copyright check) ───────────────────────────

function calculateSimilarity(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length >= 3));
    const wordsB = new Set(textB.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length >= 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w));
    return intersection.length / Math.max(wordsA.size, wordsB.size);
}

// ── Smart Tech Filtering (World Monitor tech variant pattern) ───────

const TECH_KEYWORDS = new Set([
    'ai', 'artificial intelligence', 'machine learning', 'deep learning', 'neural', 'gpt', 'llm',
    'startup', 'funding', 'series a', 'series b', 'ipo', 'valuation', 'venture', 'vc',
    'software', 'hardware', 'chip', 'semiconductor', 'processor', 'gpu', 'cpu',
    'cloud', 'saas', 'api', 'developer', 'programming', 'code', 'open source',
    'cybersecurity', 'hack', 'breach', 'encryption', 'malware', 'ransomware',
    'crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'defi', 'nft',
    'smartphone', 'iphone', 'android', 'app', 'ios', 'mobile',
    'tesla', 'ev', 'electric vehicle', 'self-driving', 'autonomous',
    'robot', 'robotics', 'automation', 'drone',
    'spacex', 'nasa', 'satellite', 'launch', 'rocket', 'space',
    'microsoft', 'google', 'apple', 'meta', 'amazon', 'nvidia', 'openai', 'anthropic',
    'data', 'privacy', 'regulation', 'tech', 'digital', 'internet', 'platform',
    'quantum', 'biotech', '5g', 'ar', 'vr', 'metaverse', 'wearable',
]);

const NON_TECH_KEYWORDS = new Set([
    'sports', 'football', 'basketball', 'soccer', 'nba', 'nfl', 'fifa',
    'celebrity', 'kardashian', 'movie review', 'box office', 'oscars', 'grammy',
    'recipe', 'cooking', 'diet', 'fashion', 'horoscope', 'weather forecast',
]);

/**
 * Smart Tech Filtering: Score articles by tech relevance.
 * Returns items with techScore >= threshold.
 */
function filterTechContent(items, threshold = 2) {
    return items
        .map(item => {
            const text = `${item.title} ${item.summary}`.toLowerCase();
            let score = 0;

            // Positive: tech keywords
            for (const kw of TECH_KEYWORDS) {
                if (text.includes(kw)) score += 1;
            }

            // Negative: non-tech keywords
            for (const kw of NON_TECH_KEYWORDS) {
                if (text.includes(kw)) score -= 3;
            }

            // Boost: known tech sources get a baseline
            if (['TechCrunch', 'Ars Technica', 'Wired', 'The Verge'].includes(item.source)) {
                score += 1;
            }

            return { ...item, techScore: score };
        })
        .filter(item => item.techScore >= threshold)
        .sort((a, b) => b.techScore - a.techScore);
}

// ── Velocity Analysis (trending detection via multi-source coverage) ─

/**
 * Velocity Analysis: Detect trending stories covered by multiple sources.
 * Groups stories by topic similarity, counts source coverage, and boosts
 * articles that appear across multiple feeds within a time window.
 */
function analyzeVelocity(items, windowHours = 6) {
    const now = Date.now();
    const windowMs = windowHours * 60 * 60 * 1000;

    // Only consider recent items
    const recent = items.filter(item => {
        if (!item.publishedAt) return true;
        return (now - new Date(item.publishedAt).getTime()) < windowMs;
    });

    // Build word-set for each item
    const itemWords = recent.map(item => {
        const text = `${item.title} ${item.summary}`.toLowerCase();
        return new Set(text.replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length >= 4));
    });

    // Find topic clusters (items covering the same story)
    const velocityScores = new Map();
    for (let i = 0; i < recent.length; i++) {
        const sources = new Set([recent[i].source]);
        for (let j = 0; j < recent.length; j++) {
            if (i === j) continue;
            const intersection = [...itemWords[i]].filter(w => itemWords[j].has(w));
            const similarity = intersection.length / Math.min(itemWords[i].size, itemWords[j].size);
            if (similarity > 0.4) {
                sources.add(recent[j].source);
            }
        }
        // Velocity = number of sources covering similar story
        velocityScores.set(i, sources.size);
    }

    return recent.map((item, i) => ({
        ...item,
        velocity: velocityScores.get(i) || 1,
        trending: (velocityScores.get(i) || 1) >= 2,
    }));
}

// ── Enhanced Clustering (from World Monitor dedup.mjs, enhanced) ────

/**
 * Cluster similar articles and pick the best representative from each cluster.
 * Uses word-level similarity (same as World Monitor dedup.mjs) with enhanced
 * scoring: prefer longer summaries, articles with images, and higher velocity.
 */
function clusterAndDeduplicate(items) {
    const clusters = [];

    for (const item of items) {
        const normalized = item.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        const words = new Set(normalized.split(' ').filter(w => w.length >= 4));

        let merged = false;
        for (const cluster of clusters) {
            const intersection = [...words].filter(w => cluster.words.has(w));
            const similarity = intersection.length / Math.min(words.size, cluster.words.size);
            if (similarity > 0.5) {
                cluster.items.push(item);
                // Merge word sets for broader matching
                for (const w of words) cluster.words.add(w);
                merged = true;
                break;
            }
        }

        if (!merged) {
            clusters.push({ words, items: [item] });
        }
    }

    // Pick best representative from each cluster
    return clusters.map(cluster => {
        if (cluster.items.length === 1) return cluster.items[0];

        // Score each item in cluster
        return cluster.items.reduce((best, item) => {
            let score = 0;
            if (item.image) score += 2;
            if (item.summary?.length > 100) score += 1;
            if (item.velocity) score += item.velocity;
            if (item.techScore) score += item.techScore;

            let bestScore = 0;
            if (best.image) bestScore += 2;
            if (best.summary?.length > 100) bestScore += 1;
            if (best.velocity) bestScore += best.velocity;
            if (best.techScore) bestScore += best.techScore;

            return score > bestScore ? item : best;
        });
    });
}

// ── Reasoning Preamble Detection (from World Monitor summarize-article.ts) ──

const TASK_NARRATION = /^(we need to|i need to|let me|i'll |i should|i will |the task is|the instructions|according to the rules|so we need to|okay[,.]\s*(i'll|let me|so|we need|the task|i should|i will)|sure[,.]\s*(i'll|let me|so|we need|the task|i should|i will|here))/i;
const PROMPT_ECHO = /^(summarize the top story|summarize the key|rules:|here are the rules|the top story is likely|generate a new|create a new title)/i;

function stripReasoningPreamble(text) {
    let cleaned = text.trim();
    cleaned = cleaned
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|thinking\|>[\s\S]*?<\/\|thinking\|>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .trim();
    if (TASK_NARRATION.test(cleaned) || PROMPT_ECHO.test(cleaned)) {
        return '';
    }
    return cleaned;
}

// ── RSS Feed Parser ─────────────────────────────────────────────────

function parseFeed(xml, source) {
    const items = [];
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

    if (isAtom) {
        const entries = xml.split(/<entry[\s>]/i).slice(1);
        for (const entry of entries) {
            const title = stripHtml(getTag(entry, 'title'));
            if (!title) continue;
            const summaryRaw = getTag(entry, 'summary') || getTag(entry, 'content');
            const summary = stripHtml(summaryRaw).slice(0, 500);
            const linkMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
                || entry.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
                || entry.match(/<link[^>]+href=["']([^"']+)["']/i);
            const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '';
            const pubDate = getTag(entry, 'published') || getTag(entry, 'updated') || '';
            const image = extractImage(entry);
            items.push({ title, summary, image: image || null, link, source: source.name, publishedAt: pubDate ? new Date(pubDate).toISOString() : null });
        }
    } else {
        const rssItems = xml.split(/<item[\s>]/i).slice(1);
        for (const item of rssItems) {
            const title = stripHtml(getTag(item, 'title'));
            if (!title) continue;
            const descriptionRaw = getTag(item, 'description') || getTag(item, 'content:encoded') || '';
            const summary = stripHtml(descriptionRaw).slice(0, 500);
            const link = getTag(item, 'link') || '';
            const pubDate = getTag(item, 'pubDate') || getTag(item, 'dc:date') || '';
            const image = extractImage(item);
            items.push({ title, summary, image: image || null, link, source: source.name, publishedAt: pubDate ? new Date(pubDate).toISOString() : null });
        }
    }
    return items;
}

// ── Article Scraper ─────────────────────────────────────────────────

async function scrapeFullArticle(url) {
    try {
        const response = await fetchWithTimeout(url, 15000);
        if (!response.ok) return null;
        const html = await response.text();

        // Extract article/main content
        let content = '';
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        if (articleMatch) {
            content = articleMatch[1];
        } else {
            const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) content = mainMatch[1];
            else {
                // Fallback: look for common content divs
                const contentMatch = html.match(/<div[^>]*class="[^"]*(?:article|post|entry|content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                if (contentMatch) content = contentMatch[1];
            }
        }

        // Extract paragraphs
        const paragraphs = [];
        const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        let match;
        while ((match = pRegex.exec(content || html)) !== null) {
            const text = stripHtml(match[1]).trim();
            if (text.length > 30) paragraphs.push(text);
        }

        return paragraphs.join('\n\n').slice(0, 8000) || null;
    } catch {
        return null;
    }
}

// ── Gemini API (with adaptive retry + cache + fallback) ─────────────

// In-memory cache — avoids duplicate API calls (30 min TTL)
const geminiCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(systemPrompt, userPrompt, jsonMode = false) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const body = {
        contents: [{
            parts: [{ text: userPrompt }],
        }],
        systemInstruction: {
            parts: [{ text: systemPrompt }],
        },
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
    };

    const MAX_RETRIES = 4;
    const INITIAL_DELAY = 5000; // 5 seconds

    // Attempt with 2.0-flash first, fallback to 1.5-flash if needed
    let models = ['gemini-2.0-flash', 'gemini-1.5-flash'];

    for (const model of models) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(35000),
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    return stripReasoningPreamble(text);
                }

                // Error handling
                const errData = await response.json().catch(() => ({}));
                const errMessage = errData?.error?.message || 'Unknown error';
                const status = response.status;

                if (status === 429 || status >= 500) {
                    // Try to parse retry delay from Google's response (e.g. "22.6s")
                    let waitMs = INITIAL_DELAY * Math.pow(2, attempt - 1);

                    // Look for rpc.RetryInfo or seconds in message
                    const retryInfo = errData?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
                    if (retryInfo?.retryDelay) {
                        const seconds = parseFloat(retryInfo.retryDelay);
                        if (!isNaN(seconds)) waitMs = (seconds + 1) * 1000;
                    } else {
                        // Regex search in message for "retry in X.Xs"
                        const match = errMessage.match(/retry in ([\d.]+)s/i);
                        if (match) waitMs = (parseFloat(match[1]) + 2) * 1000;
                    }

                    console.warn(`[Gemini] ${model} ${status}: ${errMessage.slice(0, 100)}...`);
                    console.warn(`[Gemini] Waiting ${Math.round(waitMs / 1000)}s before retry (attempt ${attempt}/${MAX_RETRIES})`);

                    await sleep(waitMs);
                    continue;
                }

                throw new Error(`Gemini ${model} error ${status}: ${JSON.stringify(errData)}`);
            } catch (err) {
                if (attempt === MAX_RETRIES) {
                    if (model === models[0]) {
                        console.error(`[Gemini] ${model} failed after ${MAX_RETRIES} attempts. Falling back to next model...`);
                        break; // Move to next model
                    }
                    throw err; // Final failure
                }
                if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
                    console.warn(`[Gemini] Timeout on ${model}, retrying...`);
                    await sleep(INITIAL_DELAY);
                    continue;
                }
                throw err;
            }
        }
    }
}

async function generateTitleAndSummary(articleContent, originalTitle, source, rssSummary) {
    // Check cache first
    const cacheKey = originalTitle.slice(0, 100);
    const cached = geminiCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        console.log(`[Gemini] Cache hit for: ${originalTitle.slice(0, 50)}...`);
        return cached.data;
    }

    const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.`;

    const systemPrompt = `${dateContext}

You are a senior tech editor for a Facebook tech news page called "TECH PULSE". 
Your job is to rewrite news into engaging, original content.

Rules:
- Generate a NEW, ORIGINAL title — not a copy of the original. Make it catchy and click-worthy for Facebook audience.
- Write a NEW, ORIGINAL summary (50-150 words) from the full article content. 
- The summary must be informative, engaging, and written in your own words.
- Focus on: what happened, why it matters, what's next.
- Tone: professional but accessible, tech-savvy audience.
- NEVER start with "Breaking:" or "Just in:" or similar clichés.
- NEVER include hashtags in the title or summary.
- Do NOT copy the original title or summary verbatim.

Output ONLY valid JSON:
{
  "title": "your new original title",
  "summary": "your new 50-150 word original summary"
}`;

    const userPrompt = `Original Title: ${originalTitle}
Source: ${source}
RSS Summary: ${rssSummary || 'N/A'}

Full Article Content:
${(articleContent || rssSummary || originalTitle).slice(0, 6000)}

Generate a new original title and 50-150 word summary.`;

    const raw = await callGemini(systemPrompt, userPrompt, true);

    let result;
    try {
        result = JSON.parse(raw);
    } catch {
        // Try to extract from non-JSON response
        const titleMatch = raw.match(/"title"\s*:\s*"([^"]+)"/);
        const summaryMatch = raw.match(/"summary"\s*:\s*"([^"]+)"/);
        if (!titleMatch || !summaryMatch) {
            throw new Error('Gemini returned unparseable response — cannot generate original content');
        }
        result = { title: titleMatch[1], summary: summaryMatch[1] };
    }

    // STRICT: must have both title and summary
    if (!result.title || !result.summary) {
        throw new Error('Gemini returned incomplete response — missing title or summary');
    }

    // Cache successful result
    geminiCache.set(cacheKey, { data: result, time: Date.now() });

    return result;
}

// ── SVG Brand Card Generator (inspired by World Monitor og-story.js) ─

function generateBrandCard(title, source, date) {
    const { colors, width, height, name, tagline } = BRAND;
    const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Word-wrap title for SVG
    const maxCharsPerLine = 36;
    const words = title.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
            if (currentLine) lines.push(currentLine.trim());
            currentLine = word;
        } else {
            currentLine = (currentLine + ' ' + word).trim();
        }
    }
    if (currentLine) lines.push(currentLine.trim());
    const titleLines = lines.slice(0, 4); // max 4 lines

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.bg}"/>
      <stop offset="100%" stop-color="#0d0d20"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
    <linearGradient id="sidebar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <g opacity="0.03">
    ${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${height}" stroke="#fff" stroke-width="1"/>`).join('\n    ')}
    ${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="${width}" y2="${i * 40}" stroke="#fff" stroke-width="1"/>`).join('\n    ')}
  </g>

  <!-- Left accent sidebar -->
  <rect x="0" y="0" width="6" height="${height}" fill="url(#sidebar)"/>

  <!-- Top gradient line -->
  <rect x="6" y="0" width="${width - 6}" height="3" fill="url(#accent)" opacity="0.6"/>

  <!-- Brand header -->
  <circle cx="60" cy="48" r="18" fill="none" stroke="${colors.primary}" stroke-width="2" filter="url(#glow)"/>
  <text x="60" y="54" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" fill="${colors.primary}" text-anchor="middle">T</text>
  
  <text x="90" y="44" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="${colors.primary}" letter-spacing="4">${escapeXml(name)}</text>
  <text x="90" y="60" font-family="system-ui, sans-serif" font-size="11" fill="${colors.textMuted}" letter-spacing="1">${escapeXml(tagline)}</text>

  <!-- Date badge -->
  <rect x="${width - 180}" y="30" width="140" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="${colors.primary}" stroke-width="1" stroke-opacity="0.2"/>
  <text x="${width - 110}" y="50" font-family="system-ui, sans-serif" font-size="13" fill="${colors.textMuted}" text-anchor="middle">${dateStr}</text>

  <!-- Separator -->
  <line x1="40" y1="80" x2="${width - 40}" y2="80" stroke="#1a1a2e" stroke-width="1"/>

  <!-- Source pill -->
  <rect x="40" y="100" width="${source.length * 10 + 40}" height="32" rx="16" fill="${colors.secondary}" opacity="0.2"/>
  <rect x="40" y="100" width="${source.length * 10 + 40}" height="32" rx="16" fill="none" stroke="${colors.secondary}" stroke-width="1" stroke-opacity="0.4"/>
  <text x="${40 + (source.length * 10 + 40) / 2}" y="121" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="${colors.secondary}" text-anchor="middle">${escapeXml(source)}</text>

  <!-- Main title -->
  ${titleLines.map((line, i) => `<text x="40" y="${180 + i * 60}" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="800" fill="${colors.text}" letter-spacing="-1">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Bottom bar -->
  <rect x="0" y="${height - 100}" width="${width}" height="100" fill="#080810"/>
  <line x1="0" y1="${height - 100}" x2="${width}" y2="${height - 100}" stroke="#1a1a2e" stroke-width="1"/>
  
  <!-- Bottom gradient accent -->
  <rect x="0" y="${height - 4}" width="${width}" height="4" fill="url(#accent)"/>

  <!-- Bottom brand -->
  <circle cx="60" cy="${height - 50}" r="16" fill="none" stroke="${colors.primary}" stroke-width="1.5"/>
  <text x="60" y="${height - 44}" font-family="system-ui, sans-serif" font-size="14" font-weight="800" fill="${colors.primary}" text-anchor="middle">T</text>
  
  <text x="88" y="${height - 56}" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#aaa" letter-spacing="2">${escapeXml(name)}</text>
  <text x="88" y="${height - 38}" font-family="system-ui, sans-serif" font-size="12" fill="#666">${escapeXml(tagline)}</text>

  <!-- CTA -->
  <rect x="${width - 220}" y="${height - 72}" width="180" height="40" rx="20" fill="url(#accent)"/>
  <text x="${width - 130}" y="${height - 46}" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">READ MORE →</text>
</svg>`;

    return svg;
}

function svgToBase64DataUri(svg) {
    const encoded = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
}

// ── Handlers ────────────────────────────────────────────────────────

/**
 * Full pipeline: Fetch → Filter → Velocity → Cluster → Sort
 * Applies all World Monitor-inspired intelligence processing.
 */
async function fetchAllFeeds(sourceFilter) {
    const feedsToFetch = sourceFilter
        ? FEEDS.filter(f => f.key === sourceFilter)
        : FEEDS;

    const results = await Promise.allSettled(
        feedsToFetch.map(async (feed) => {
            try {
                const response = await fetchWithTimeout(feed.url);
                if (!response.ok) return [];
                const xml = await response.text();
                return parseFeed(xml, feed);
            } catch { return []; }
        })
    );

    let allItems = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            allItems.push(...result.value);
        }
    }

    // Pipeline: Smart Tech Filter → Velocity Analysis → Cluster & Dedup
    console.log(`[Pipeline] Raw items: ${allItems.length}`);

    // Step 1: Smart Tech Filtering — remove non-tech content
    allItems = filterTechContent(allItems, 1);
    console.log(`[Pipeline] After tech filter: ${allItems.length}`);

    // Step 2: Velocity Analysis — detect trending multi-source stories
    allItems = analyzeVelocity(allItems, 12);
    console.log(`[Pipeline] Trending items: ${allItems.filter(i => i.trending).length}`);

    // Step 3: Enhanced Clustering — group similar stories, pick best
    allItems = clusterAndDeduplicate(allItems);
    console.log(`[Pipeline] After clustering: ${allItems.length}`);

    // Final sort: trending first, then by techScore, then newest
    allItems.sort((a, b) => {
        // Trending stories first
        if (a.trending && !b.trending) return -1;
        if (!a.trending && b.trending) return 1;

        // Higher velocity first
        if ((a.velocity || 1) !== (b.velocity || 1)) return (b.velocity || 1) - (a.velocity || 1);

        // Higher tech score first
        if ((a.techScore || 0) !== (b.techScore || 0)) return (b.techScore || 0) - (a.techScore || 0);

        // Newest first
        if (!a.publishedAt && !b.publishedAt) return 0;
        if (!a.publishedAt) return 1;
        if (!b.publishedAt) return -1;
        return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return allItems;
}

// Raw RSS endpoint
async function handleTechNews(urlObj) {
    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '20', 10), 100);
    const sourceFilter = (urlObj.searchParams.get('source') || '').toLowerCase();
    const allItems = await fetchAllFeeds(sourceFilter);

    return {
        status: 200,
        body: {
            items: allItems.slice(0, limit),
            fetchedAt: new Date().toISOString(),
            count: Math.min(allItems.length, limit),
            sources: FEEDS.map(f => f.name),
        },
    };
}

// AI-processed endpoint — STRICT: no fallback to original content (copyright protection)
async function handleGenerateTechNews(urlObj) {
    if (!GEMINI_API_KEY) {
        return { status: 503, body: { error: 'GEMINI_API_KEY not configured. Set it in Railway environment variables.', ok: false } };
    }

    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '1', 10), 5);
    const sourceFilter = (urlObj.searchParams.get('source') || '').toLowerCase();
    const allItems = await fetchAllFeeds(sourceFilter);

    if (allItems.length === 0) {
        return { status: 404, body: { error: 'No tech news found after pipeline filtering', ok: false, sources: FEEDS.map(f => f.key) } };
    }

    const toProcess = allItems.slice(0, limit + 3); // fetch extra candidates in case some fail
    const articles = [];

    for (const item of toProcess) {
        if (articles.length >= limit) break; // got enough

        try {
            console.log(`[Generate] Processing: ${item.title}`);

            // 1. Scrape full article
            const fullContent = await scrapeFullArticle(item.link);

            // 2. Generate title + summary with Gemini — MUST succeed
            const ai = await generateTitleAndSummary(fullContent, item.title, item.source, item.summary);

            // 3. STRICT VALIDATION: AI must produce original content
            if (!ai.title || !ai.summary) {
                console.warn(`[Generate] ✗ Gemini returned empty — skipping: ${item.title}`);
                continue;
            }

            // Check title is actually different from original (copyright safety)
            const titleSimilarity = calculateSimilarity(ai.title, item.title);
            if (titleSimilarity > 0.8) {
                console.warn(`[Generate] ✗ Title too similar to original (${(titleSimilarity * 100).toFixed(0)}%) — skipping`);
                continue;
            }

            // Validate summary word count (50-150 words)
            const wordCount = ai.summary.split(/\s+/).length;
            if (wordCount < 30 || wordCount > 200) {
                console.warn(`[Generate] ⚠ Summary word count ${wordCount} — outside 50-150 range but proceeding`);
            }

            // 4. Generate brand-consistent image prompt for n8n Gemini Image node
            const imagePrompt = buildBrandImagePrompt(ai.title, ai.summary, item.source);

            articles.push({
                // AI-generated original content (copyright-safe)
                title: ai.title,
                summary: ai.summary,
                imagePrompt,
                source: item.source,
                sourceUrl: item.link,

                // Pipeline intelligence metadata
                techScore: item.techScore || 0,
                velocity: item.velocity || 1,
                trending: item.trending || false,

                // Meta
                wordCount,
                generatedAt: new Date().toISOString(),
                publishedAt: item.publishedAt,
            });

            console.log(`[Generate] ✓ Done: "${ai.title}" (${wordCount} words, techScore=${item.techScore}, velocity=${item.velocity})`);

        } catch (err) {
            // STRICT: Do NOT fallback to original content — skip this article
            console.error(`[Generate] ✗ STOPPED: ${item.title} — ${err.message}`);
            // Try next article in the queue
            continue;
        }
    }

    // If no articles could be generated, return error
    if (articles.length === 0) {
        return {
            status: 503,
            body: {
                ok: false,
                error: 'AI generation failed for all articles. Gemini API may be rate-limited. No original content returned to protect copyright.',
                retryAfter: 60,
            },
        };
    }

    return {
        status: 200,
        body: {
            ok: true,
            articles,
            pipeline: {
                feedsSources: FEEDS.map(f => f.name),
                smartFilter: true,
                velocityAnalysis: true,
                clustering: true,
                brandTemplate: 'TECH PULSE',
            },
            generatedAt: new Date().toISOString(),
            count: articles.length,
            model: 'gemini-2.0-flash',
        },
    };
}

// ── Step-by-Step Handlers (for n8n pipeline with 30s delays) ────────

/**
 * Step 1: Pick the top article from RSS pipeline (no Gemini call)
 * Returns: article data + full scraped content
 */
async function handleStepPick(urlObj) {
    const allItems = await fetchAllFeeds();
    if (allItems.length === 0) {
        return { status: 404, body: { ok: false, error: 'No tech news found after pipeline filtering' } };
    }
    const article = allItems[0]; // top-ranked by tech score + velocity + freshness

    // Scrape full content (no Gemini needed)
    let fullContent = '';
    try {
        fullContent = await scrapeFullArticle(article.link);
    } catch (e) {
        console.warn(`[Step1] Scrape failed: ${e.message}, using RSS summary`);
    }

    return {
        status: 200,
        body: {
            ok: true,
            step: 1,
            article: {
                originalTitle: article.title,
                rssSummary: article.summary || '',
                fullContent: (fullContent || article.summary || article.title).slice(0, 6000),
                source: article.source,
                sourceUrl: article.link,
                publishedAt: article.publishedAt,
                techScore: article.techScore || 0,
                velocity: article.velocity || 1,
                trending: article.trending || false,
            },
        },
    };
}

/**
 * Step 2: Generate AI title (1 Gemini call)
 * Input: originalTitle, source, fullContent (from Step 1)
 */
async function handleStepTitle(urlObj) {
    if (!GEMINI_API_KEY) {
        return { status: 503, body: { ok: false, error: 'GEMINI_API_KEY not configured' } };
    }

    const originalTitle = urlObj.searchParams.get('originalTitle') || '';
    const source = urlObj.searchParams.get('source') || '';
    const fullContent = urlObj.searchParams.get('fullContent') || '';

    if (!originalTitle) {
        return { status: 400, body: { ok: false, error: 'Missing originalTitle parameter' } };
    }

    const systemPrompt = `You are a senior tech editor for "TECH PULSE" Facebook page.
Generate a NEW, ORIGINAL, catchy title for this tech news article.
Rules:
- Must be completely different from the original — rewrite in your own words
- Make it click-worthy for Facebook audience
- NEVER start with "Breaking:" or "Just in:" 
- No hashtags
- Output ONLY the title text, nothing else`;

    const userPrompt = `Original Title: ${originalTitle}
Source: ${source}
Article Content: ${fullContent.slice(0, 4000)}

Write a new original title:`;

    const aiTitle = await callGemini(systemPrompt, userPrompt);
    const cleanTitle = aiTitle.replace(/^["']|["']$/g, '').trim();

    // Validate it's actually different
    const similarity = calculateSimilarity(cleanTitle, originalTitle);
    if (similarity > 0.8) {
        return { status: 422, body: { ok: false, error: `Title too similar to original (${(similarity * 100).toFixed(0)}%)`, retryAfter: 5 } };
    }

    return {
        status: 200,
        body: {
            ok: true,
            step: 2,
            title: cleanTitle,
            originalTitle,
            similarity: `${(similarity * 100).toFixed(0)}%`,
        },
    };
}

/**
 * Step 3: Generate AI summary (1 Gemini call)
 * Input: title (AI-generated from Step 2), originalTitle, source, fullContent
 */
async function handleStepSummary(urlObj) {
    if (!GEMINI_API_KEY) {
        return { status: 503, body: { ok: false, error: 'GEMINI_API_KEY not configured' } };
    }

    const title = urlObj.searchParams.get('title') || '';
    const source = urlObj.searchParams.get('source') || '';
    const fullContent = urlObj.searchParams.get('fullContent') || '';

    if (!title) {
        return { status: 400, body: { ok: false, error: 'Missing title parameter (from step 2)' } };
    }

    const systemPrompt = `You are a senior tech editor for "TECH PULSE" Facebook page.
Write a NEW, ORIGINAL summary (50-150 words) for this article.
Rules:
- Informative, engaging, written in your own words
- Focus: what happened, why it matters, what's next
- Professional but accessible tone
- No hashtags, no clichés
- Output ONLY the summary text, nothing else`;

    const userPrompt = `Title: ${title}
Source: ${source}
Article Content: ${fullContent.slice(0, 5000)}

Write a 50-150 word original summary:`;

    const aiSummary = await callGemini(systemPrompt, userPrompt);
    const cleanSummary = aiSummary.replace(/^["']|["']$/g, '').trim();

    const wordCount = cleanSummary.split(/\s+/).length;
    if (wordCount < 20) {
        return { status: 422, body: { ok: false, error: `Summary too short (${wordCount} words)`, retryAfter: 5 } };
    }

    return {
        status: 200,
        body: {
            ok: true,
            step: 3,
            summary: cleanSummary,
            wordCount,
            source,
        },
    };
}

/**
 * Step 4: Generate brand-consistent image prompt (NO Gemini call — just builds prompt)
 * Input: title, summary (from Steps 2-3)
 */
async function handleStepImagePrompt(urlObj) {
    const title = urlObj.searchParams.get('title') || '';
    const summary = urlObj.searchParams.get('summary') || '';
    const source = urlObj.searchParams.get('source') || '';

    if (!title) {
        return { status: 400, body: { ok: false, error: 'Missing title parameter' } };
    }

    const imagePrompt = buildBrandImagePrompt(title, summary, source);

    return {
        status: 200,
        body: {
            ok: true,
            step: 4,
            imagePrompt,
        },
    };
}

/**
 * Step 5: Compose final Facebook post (NO Gemini call — assembles everything)
 * Input: title, summary, source, sourceUrl, imagePrompt
 */
async function handleStepCompose(urlObj) {
    const title = urlObj.searchParams.get('title') || '';
    const summary = urlObj.searchParams.get('summary') || '';
    const source = urlObj.searchParams.get('source') || '';
    const sourceUrl = urlObj.searchParams.get('sourceUrl') || '';

    if (!title || !summary) {
        return { status: 400, body: { ok: false, error: 'Missing title or summary' } };
    }

    // Format the Facebook post message
    const post = `${title}

${summary}

📰 Source: ${source}
🔗 ${sourceUrl}

#TechPulse #TechNews #AI #Technology`;

    return {
        status: 200,
        body: {
            ok: true,
            step: 5,
            post: {
                message: post,
                title,
                summary,
                source,
                sourceUrl,
            },
            generatedAt: new Date().toISOString(),
        },
    };
}

// ── HTTP Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const path = urlObj.pathname;

    // Health check
    if (path === '/health' || path === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            service: 'tech-news-api',
            gemini: GEMINI_API_KEY ? 'configured' : 'missing',
            endpoints: [
                '/api/tech-news',
                '/api/tech-news/generate',
                '/api/step/pick',
                '/api/step/title',
                '/api/step/summary',
                '/api/step/image-prompt',
                '/api/step/compose',
            ],
        }));
        return;
    }

    // ── Step-by-step endpoints (for n8n pipeline) ──

    const stepRoutes = {
        '/api/step/pick': handleStepPick,
        '/api/step/title': handleStepTitle,
        '/api/step/summary': handleStepSummary,
        '/api/step/image-prompt': handleStepImagePrompt,
        '/api/step/compose': handleStepCompose,
    };

    if (stepRoutes[path]) {
        try {
            const result = await stepRoutes[path](urlObj);
            res.writeHead(result.status, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify(result.body, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: error?.message, retryAfter: 30 }));
        }
        return;
    }

    // AI-generated tech news (combined - legacy)
    if (path === '/api/tech-news/generate') {
        try {
            const result = await handleGenerateTechNews(urlObj);
            res.writeHead(result.status, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify(result.body, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Generation failed', details: error?.message }));
        }
        return;
    }

    // Raw RSS tech news
    if (path === '/api/tech-news') {
        try {
            const result = await handleTechNews(urlObj);
            res.writeHead(result.status, {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=600',
            });
            res.end(JSON.stringify(result.body, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch tech news', details: error?.message }));
        }
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`🚀 Tech News API running on port ${PORT}`);
    console.log(`   ── Step Pipeline (n8n) ──`);
    console.log(`   → Step 1: GET /api/step/pick`);
    console.log(`   → Step 2: GET /api/step/title`);
    console.log(`   → Step 3: GET /api/step/summary`);
    console.log(`   → Step 4: GET /api/step/image-prompt`);
    console.log(`   → Step 5: GET /api/step/compose`);
    console.log(`   ── Combined ──`);
    console.log(`   → GET /api/tech-news`);
    console.log(`   → GET /api/tech-news/generate`);
    console.log(`   → Gemini: ${GEMINI_API_KEY ? '✓ configured' : '✗ missing GEMINI_API_KEY'}`);
});

