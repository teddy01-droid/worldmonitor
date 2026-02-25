/**
 * Tech News API Endpoint for n8n Automation
 * 
 * Fetches tech RSS feeds, parses them, and returns structured JSON
 * with headline, summary, photo, link, source, and publishedAt.
 * 
 * Query params:
 *   ?limit=20     — max items to return (default 20)
 *   ?source=xxx   — filter by source name (e.g., techcrunch, verge, arstechnica, hackernews, wired)
 * 
 * Designed to be called from n8n HTTP Request node.
 */

export const config = { runtime: 'edge' };

// ── RSS Feed Sources ────────────────────────────────────────────────
const FEEDS = [
  { name: 'TechCrunch',    key: 'techcrunch',   url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge',     key: 'verge',        url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica',  key: 'arstechnica',  url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'Hacker News',   key: 'hackernews',   url: 'https://hnrss.org/frontpage' },
  { name: 'Wired',         key: 'wired',        url: 'https://www.wired.com/feed/rss' },
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

/**
 * Extract tag content from XML string.
 * Returns the content between the first <tag> and </tag>, or empty string.
 */
function getTag(xml, tag) {
  // Try CDATA first
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  // Plain content
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
}

/**
 * Extract image URL from an RSS item XML block.
 * Checks multiple common patterns.
 */
function extractImage(itemXml) {
  // 1. <media:content url="...">
  const mediaMatch = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaMatch) return mediaMatch[1];

  // 2. <media:thumbnail url="...">
  const thumbMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (thumbMatch) return thumbMatch[1];

  // 3. <enclosure url="..." type="image/...">
  const encMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/i);
  if (encMatch) return encMatch[1];

  // Also try enclosure without type check (some feeds only have url)
  const encMatch2 = itemXml.match(/<enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp|gif))[^"']*["']/i);
  if (encMatch2) return encMatch2[1];

  // 4. <image><url>...</url></image>
  const imgUrlMatch = itemXml.match(/<image>\s*<url>([^<]+)<\/url>/i);
  if (imgUrlMatch) return imgUrlMatch[1].trim();

  // 5. First <img src="..."> inside description/content
  const descContent = getTag(itemXml, 'description') || getTag(itemXml, 'content:encoded') || getTag(itemXml, 'content');
  const imgSrcMatch = descContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgSrcMatch) return imgSrcMatch[1];

  return null;
}

/**
 * Strip HTML tags and decode basic entities.
 */
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

/**
 * Parse a single RSS/Atom feed XML into an array of items.
 */
function parseFeed(xml, source) {
  const items = [];

  // Detect Atom vs RSS
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

  if (isAtom) {
    // Atom: split by <entry>
    const entries = xml.split(/<entry[\s>]/i).slice(1);
    for (const entry of entries) {
      const title = stripHtml(getTag(entry, 'title'));
      if (!title) continue;

      const summaryRaw = getTag(entry, 'summary') || getTag(entry, 'content');
      const summary = stripHtml(summaryRaw).slice(0, 300);

      // Atom link: <link href="..." rel="alternate" />
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
    // RSS: split by <item>
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

// ── Main Handler ────────────────────────────────────────────────────

export default async function handler(req) {
  // CORS — allow any origin for n8n access
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const sourceFilter = (url.searchParams.get('source') || '').toLowerCase();

  // Filter feeds if source param provided
  const feedsToFetch = sourceFilter
    ? FEEDS.filter(f => f.key === sourceFilter)
    : FEEDS;

  if (feedsToFetch.length === 0) {
    return new Response(JSON.stringify({
      error: 'Unknown source',
      available: FEEDS.map(f => f.key),
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // Fetch all feeds in parallel
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

    // Collect all items
    let allItems = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allItems.push(...result.value);
      }
    }

    // Sort by publishedAt descending (newest first)
    allItems.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    // Apply limit
    allItems = allItems.slice(0, limit);

    const body = JSON.stringify({
      items: allItems,
      fetchedAt: new Date().toISOString(),
      count: allItems.length,
      sources: feedsToFetch.map(f => f.name),
    }, null, 2);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=300',
        ...corsHeaders,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to fetch tech news',
      details: error?.message || String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
