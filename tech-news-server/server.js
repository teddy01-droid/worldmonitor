/**
 * Tech News API Server — Standalone Node.js server for Railway
 * 
 * Fetches tech RSS feeds and returns structured JSON.
 * No dependencies needed — uses built-in Node.js http module + fetch.
 * 
 * Endpoints:
 *   GET /api/tech-news              → all tech news
 *   GET /api/tech-news?limit=10     → limit results
 *   GET /api/tech-news?source=verge → filter by source
 *   GET /health                     → health check
 * 
 * Deploy on Railway as a separate service.
 */

import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;

// ── RSS Feed Sources ────────────────────────────────────────────────
const FEEDS = [
    { name: 'TechCrunch', key: 'techcrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'The Verge', key: 'verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica', key: 'arstechnica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'Hacker News', key: 'hackernews', url: 'https://hnrss.org/frontpage' },
    { name: 'Wired', key: 'wired', url: 'https://www.wired.com/feed/rss' },
];

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; TechNewsBot/1.0)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
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
    const mediaMatch = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
    if (mediaMatch) return mediaMatch[1];

    const thumbMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    if (thumbMatch) return thumbMatch[1];

    const encMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/i);
    if (encMatch) return encMatch[1];

    const encMatch2 = itemXml.match(/<enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp|gif))[^"']*["']/i);
    if (encMatch2) return encMatch2[1];

    const imgUrlMatch = itemXml.match(/<image>\s*<url>([^<]+)<\/url>/i);
    if (imgUrlMatch) return imgUrlMatch[1].trim();

    const descContent = getTag(itemXml, 'description') || getTag(itemXml, 'content:encoded') || getTag(itemXml, 'content');
    const imgSrcMatch = descContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgSrcMatch) return imgSrcMatch[1];

    return null;
}

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function parseFeed(xml, source) {
    const items = [];
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

    if (isAtom) {
        const entries = xml.split(/<entry[\s>]/i).slice(1);
        for (const entry of entries) {
            const title = stripHtml(getTag(entry, 'title'));
            if (!title) continue;

            const summaryRaw = getTag(entry, 'summary') || getTag(entry, 'content');
            const summary = stripHtml(summaryRaw).slice(0, 300);

            const linkMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
                || entry.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
                || entry.match(/<link[^>]+href=["']([^"']+)["']/i);
            const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '';

            const pubDate = getTag(entry, 'published') || getTag(entry, 'updated') || '';
            const image = extractImage(entry);

            items.push({
                title,
                summary: summary || '',
                image: image || null,
                link,
                source: source.name,
                publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
            });
        }
    } else {
        const rssItems = xml.split(/<item[\s>]/i).slice(1);
        for (const item of rssItems) {
            const title = stripHtml(getTag(item, 'title'));
            if (!title) continue;

            const descriptionRaw = getTag(item, 'description') || getTag(item, 'content:encoded') || '';
            const summary = stripHtml(descriptionRaw).slice(0, 300);

            const link = getTag(item, 'link') || '';
            const pubDate = getTag(item, 'pubDate') || getTag(item, 'dc:date') || '';
            const image = extractImage(item);

            items.push({
                title,
                summary: summary || '',
                image: image || null,
                link,
                source: source.name,
                publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
            });
        }
    }

    return items;
}

// ── Request Handler ─────────────────────────────────────────────────

async function handleTechNews(urlObj) {
    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '20', 10), 100);
    const sourceFilter = (urlObj.searchParams.get('source') || '').toLowerCase();

    const feedsToFetch = sourceFilter
        ? FEEDS.filter(f => f.key === sourceFilter)
        : FEEDS;

    if (feedsToFetch.length === 0) {
        return {
            status: 400,
            body: { error: 'Unknown source', available: FEEDS.map(f => f.key) },
        };
    }

    const results = await Promise.allSettled(
        feedsToFetch.map(async (feed) => {
            try {
                const response = await fetchWithTimeout(feed.url);
                if (!response.ok) return [];
                const xml = await response.text();
                return parseFeed(xml, feed);
            } catch {
                return [];
            }
        })
    );

    let allItems = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            allItems.push(...result.value);
        }
    }

    allItems.sort((a, b) => {
        if (!a.publishedAt && !b.publishedAt) return 0;
        if (!a.publishedAt) return 1;
        if (!b.publishedAt) return -1;
        return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    allItems = allItems.slice(0, limit);

    return {
        status: 200,
        body: {
            items: allItems,
            fetchedAt: new Date().toISOString(),
            count: allItems.length,
            sources: feedsToFetch.map(f => f.name),
        },
    };
}

// ── HTTP Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
    // CORS headers — allow any origin for n8n
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
        res.end(JSON.stringify({ status: 'ok', service: 'tech-news-api' }));
        return;
    }

    // Tech news endpoint
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
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['/api/tech-news', '/health'] }));
});

server.listen(PORT, () => {
    console.log(`🚀 Tech News API running on port ${PORT}`);
    console.log(`   → http://localhost:${PORT}/api/tech-news`);
});
