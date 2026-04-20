/**
 * Job Date Finder — detector.js
 *
 * Exact detection method:
 *   1. Fetch raw HTML via CORS proxy (allorigins.win)
 *   2. Parse <script type="application/ld+json"> for JobPosting.datePosted (same as Google Jobs)
 *   3. Fallback: <meta> tags (article:published_time, pubdate, etc.)
 *   4. Fallback: Microdata itemprop=datePosted / <time datetime>
 *   5. Fallback: Date pattern in URL path
 */

// ─── CORS Proxy ───────────────────────────────────────────────────────────────
// allorigins returns JSON: { contents: "<raw html>", status: { ... } }
const PROXY = 'https://api.allorigins.win/get?url=';

// ─── Entry point ─────────────────────────────────────────────────────────────
async function detect() {
  const input = document.getElementById('url-input');
  const btn   = document.getElementById('detect-btn');
  const out   = document.getElementById('result-area');

  let url = input.value.trim();
  if (!url) { input.focus(); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  btn.disabled = true;
  out.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Fetching raw HTML via proxy &amp; scanning for date layers…</span>
    </div>`;

  try {
    // ── Fetch via proxy ──────────────────────────────────────────────────────
    const proxyUrl = PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`Proxy returned HTTP ${res.status}`);

    const json = await res.json();
    const html = (json.contents || '').trim();
    if (!html) throw new Error('Proxy returned empty content. The site may block scrapers or require JavaScript rendering.');

    // ── Run all detection layers ─────────────────────────────────────────────
    const layers = [
      detectLdJson(html),
      detectMetaTags(html),
      detectMicrodata(html),
      detectUrlPattern(url),
    ];

    const winner = layers.find(l => l.found);
    renderResult(layers, winner);

  } catch (err) {
    renderError(err.message);
  }

  btn.disabled = false;
}

// ─── Layer 1: JSON-LD ─────────────────────────────────────────────────────────
function detectLdJson(html) {
  const layer = {
    num: '01',
    name: 'JSON-LD structured data',
    field: 'datePosted / datePublished',
    found: false,
    date: null,
    detail: '',
    source: null,
  };

  // Extract all <script type="application/ld+json"> blocks
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    let obj;
    try { obj = JSON.parse(match[1]); } catch { continue; }

    // Flatten: handle arrays and @graph
    const items = [];
    const flatten = (node) => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(flatten); return; }
      items.push(node);
      if (node['@graph']) flatten(node['@graph']);
    };
    flatten(obj);

    for (const item of items) {
      // Prefer JobPosting, but also check generic types
      const date = item.datePosted || item.datePublished || item.date;
      if (date && isValidDate(date)) {
        const type = item['@type'] || 'Unknown';
        const field = item.datePosted ? 'datePosted' : item.datePublished ? 'datePublished' : 'date';
        layer.found  = true;
        layer.date   = normalizeDate(date);
        layer.detail = `Found in @type="${Array.isArray(type) ? type.join(', ') : type}" → "${field}"`;
        layer.source = `ld+json:${field}`;
        return layer;
      }
    }
  }

  layer.detail = 'No ld+json block contained datePosted or datePublished';
  return layer;
}

// ─── Layer 2: Meta tags ───────────────────────────────────────────────────────
function detectMetaTags(html) {
  const layer = {
    num: '02',
    name: 'HTML meta tags',
    field: 'article:published_time · pubdate · DC.date',
    found: false,
    date: null,
    detail: '',
    source: null,
  };

  const patterns = [
    { re: /property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i, key: 'article:published_time' },
    { re: /content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i, key: 'article:published_time' },
    { re: /name=["']date["'][^>]+content=["']([^"']+)["']/i,                       key: 'name=date' },
    { re: /content=["']([^"']+)["'][^>]+name=["']date["']/i,                       key: 'name=date' },
    { re: /name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,                    key: 'pubdate' },
    { re: /content=["']([^"']+)["'][^>]+name=["']pubdate["']/i,                    key: 'pubdate' },
    { re: /name=["']publish[_-]?date["'][^>]+content=["']([^"']+)["']/i,           key: 'publishDate' },
    { re: /content=["']([^"']+)["'][^>]+name=["']publish[_-]?date["']/i,           key: 'publishDate' },
    { re: /name=["']DC\.date["'][^>]+content=["']([^"']+)["']/i,                   key: 'DC.date' },
    { re: /content=["']([^"']+)["'][^>]+name=["']DC\.date["']/i,                   key: 'DC.date' },
    { re: /property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,      key: 'og:published_time' },
    { re: /content=["']([^"']+)["'][^>]+property=["']og:published_time["']/i,      key: 'og:published_time' },
    // Adzuna-specific / generic
    { re: /name=["']job[_-]?date["'][^>]+content=["']([^"']+)["']/i,               key: 'job:date' },
    { re: /content=["']([^"']+)["'][^>]+name=["']job[_-]?date["']/i,               key: 'job:date' },
  ];

  for (const { re, key } of patterns) {
    const m = html.match(re);
    if (m && isValidDate(m[1])) {
      layer.found  = true;
      layer.date   = normalizeDate(m[1]);
      layer.detail = `Found <meta ${key}>`;
      layer.source = `meta:${key}`;
      return layer;
    }
  }

  layer.detail = 'No date-related meta tags found';
  return layer;
}

// ─── Layer 3: Microdata ───────────────────────────────────────────────────────
function detectMicrodata(html) {
  const layer = {
    num: '03',
    name: 'Microdata (itemprop)',
    field: 'itemprop=datePosted · <time datetime>',
    found: false,
    date: null,
    detail: '',
    source: null,
  };

  const patterns = [
    // itemprop=datePosted with content or datetime attribute (both attribute orderings)
    { re: /itemprop=["']datePosted["'][^>]*(?:content|datetime)=["']([^"']+)["']/i,   key: 'itemprop=datePosted (content)' },
    { re: /(?:content|datetime)=["']([^"']+)["'][^>]*itemprop=["']datePosted["']/i,   key: 'itemprop=datePosted (content)' },
    { re: /itemprop=["']datePublished["'][^>]*(?:content|datetime)=["']([^"']+)["']/i,key: 'itemprop=datePublished' },
    { re: /(?:content|datetime)=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i,key: 'itemprop=datePublished' },
    // <time datetime="YYYY-MM-DD">
    { re: /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2}[^"']*?)["']/i,                  key: '<time datetime>' },
  ];

  for (const { re, key } of patterns) {
    const m = html.match(re);
    if (m && isValidDate(m[1])) {
      layer.found  = true;
      layer.date   = normalizeDate(m[1]);
      layer.detail = `Found ${key} attribute`;
      layer.source = `microdata:${key}`;
      return layer;
    }
  }

  layer.detail = 'No microdata date attributes found';
  return layer;
}

// ─── Layer 4: URL pattern ─────────────────────────────────────────────────────
function detectUrlPattern(url) {
  const layer = {
    num: '04',
    name: 'URL date pattern',
    field: 'Path segments (YYYY/MM/DD)',
    found: false,
    date: null,
    detail: '',
    source: null,
  };

  const patterns = [
    /\/(\d{4})\/(\d{2})\/(\d{2})\//,
    /[/_-](\d{4})-(\d{2})-(\d{2})(?:[/_?#]|$)/,
    /[?&](?:date|posted|published)=(\d{4}-\d{2}-\d{2})/i,
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const ds = m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01');
      if (isValidDate(ds)) {
        layer.found  = true;
        layer.date   = ds;
        layer.detail = `Date encoded in URL: ${ds}`;
        layer.source = 'url:pattern';
        return layer;
      }
    }
  }

  layer.detail = 'No date pattern detected in URL';
  return layer;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidDate(str) {
  if (!str || typeof str !== 'string') return false;
  const d = new Date(str.trim().substring(0, 25)); // truncate ISO timestamp
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2010 && d <= new Date();
}

function normalizeDate(str) {
  // Return ISO date string YYYY-MM-DD
  const d = new Date(str.trim().substring(0, 25));
  if (isNaN(d.getTime())) return str;
  return d.toISOString().substring(0, 10);
}

function formatDisplay(isoDate) {
  const d = new Date(isoDate + 'T12:00:00'); // noon to avoid timezone flip
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function daysAgo(isoDate) {
  const d    = new Date(isoDate + 'T12:00:00');
  const now  = new Date();
  const diff = Math.round((now - d) / 86400000);
  if (diff < 0)   return 'future date';
  if (diff === 0) return 'Today';
  if (diff === 1) return '1 day ago';
  if (diff < 7)   return `${diff} days ago`;
  if (diff < 14)  return '1 week ago';
  if (diff < 30)  return `${Math.floor(diff / 7)} weeks ago`;
  if (diff < 60)  return '1 month ago';
  return `${Math.round(diff / 30)} months ago`;
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderResult(layers, winner) {
  const out = document.getElementById('result-area');

  const traceRows = layers.map(l => `
    <div class="trace-row ${l.found ? 'found' : 'miss'}">
      <span class="trace-num">${l.num}</span>
      <div>
        <div class="trace-row-left">
          <span class="status-dot"></span>
          <div>
            <span class="trace-name">${l.name}</span>
            <span class="trace-detail">${escapeHtml(l.detail)}</span>
          </div>
        </div>
      </div>
      <span class="trace-value">${l.found ? escapeHtml(l.date) : '—'}</span>
    </div>`).join('');

  if (!winner) {
    out.innerHTML = `
      <div class="no-date-block">
        No date found across all 4 layers.
        <div style="margin-top:8px;font-size:12px">
          This usually means the page is JavaScript-rendered (SPA) — the HTML source is a blank shell and the date loads via API after the browser executes JS. Sites like Greenhouse, Workday, and Lever do this. A headless browser (Puppeteer/Playwright) is required for those.
        </div>
      </div>
      <div style="margin-top:16px">
        <div class="layer-trace">
          <div class="layer-trace-header">Detection trace — all layers</div>
          ${traceRows}
        </div>
      </div>`;
    return;
  }

  out.innerHTML = `
    <div class="result-block">
      <div class="result-date-row">
        <div class="result-date">${formatDisplay(winner.date)}</div>
        <div class="result-age">${daysAgo(winner.date)}</div>
      </div>
      <div class="result-source">postedAtSource: ${escapeHtml(winner.source)}</div>
      <div class="layer-trace">
        <div class="layer-trace-header">Detection trace — all layers</div>
        ${traceRows}
      </div>
    </div>`;
}

function renderError(msg) {
  const hints = {
    '403': 'The site returned 403 Forbidden — it blocks scrapers. Try viewing page source manually and searching for <code>datePosted</code> or <code>ld+json</code>.',
    'empty': 'The proxy returned empty HTML — the page likely requires JavaScript to render content.',
    'default': 'The site may block the CORS proxy, require login, or render content via JavaScript. Check page source manually: right-click → View Page Source → search for <code>datePosted</code>.',
  };

  const hint = msg.includes('403') ? hints['403']
             : msg.includes('empty') ? hints['empty']
             : hints['default'];

  document.getElementById('result-area').innerHTML = `
    <div class="error-block">
      <div class="error-title">Could not fetch page</div>
      ${escapeHtml(msg)}
      <div class="error-hint">${hint}</div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Enter key support ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') detect();
  });
});
