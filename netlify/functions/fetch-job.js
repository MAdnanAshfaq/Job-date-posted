// netlify/functions/fetch-job.js
// Serverless function: fetches raw HTML of any job URL server-side (no CORS issues)
// then extracts the posted date across 4 layers.

const https = require("https");
const http = require("http");

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));

    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "identity",
          Connection: "keep-alive",
        },
      },
      (res) => {
        // Follow redirects
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(fetchUrl(next, redirectCount + 1));
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            status: res.statusCode,
            headers: res.headers,
          })
        );
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("Request timed out after 12s"));
    });
  });
}

// ─── Layer 1: JSON-LD ────────────────────────────────────────────────────────
function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const raw = match[1].trim();
      const obj = JSON.parse(raw);
      const items = [obj, ...(obj["@graph"] || [])].flat().filter(Boolean);
      for (const item of items) {
        // Walk nested objects too (some wrap JobPosting in an array)
        const candidates = Array.isArray(item) ? item : [item];
        for (const c of candidates) {
          const dateFields = [
            "datePosted",
            "datePublished",
            "dateCreated",
            "uploadDate",
            "date",
          ];
          for (const field of dateFields) {
            if (c[field] && typeof c[field] === "string") {
              results.push({
                date: c[field],
                source: `ld+json:${field}`,
                context: c["@type"] ? `@type: ${c["@type"]}` : "JSON-LD block",
              });
            }
          }
        }
      }
    } catch (_) {
      // malformed JSON-LD — skip
    }
  }
  return results;
}

// ─── Layer 2: Meta tags ──────────────────────────────────────────────────────
function extractMeta(html) {
  const results = [];
  const patterns = [
    { re: /property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i, label: "article:published_time" },
    { re: /content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i, label: "article:published_time" },
    { re: /name=["']date["'][^>]+content=["']([^"']+)["']/i, label: "meta:date" },
    { re: /content=["']([^"']+)["'][^>]+name=["']date["']/i, label: "meta:date" },
    { re: /name=["']pubdate["'][^>]+content=["']([^"']+)["']/i, label: "meta:pubdate" },
    { re: /content=["']([^"']+)["'][^>]+name=["']pubdate["']/i, label: "meta:pubdate" },
    { re: /name=["']publishdate["'][^>]+content=["']([^"']+)["']/i, label: "meta:publishdate" },
    { re: /name=["']publish_date["'][^>]+content=["']([^"']+)["']/i, label: "meta:publish_date" },
    { re: /property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i, label: "og:published_time" },
    { re: /content=["']([^"']+)["'][^>]+property=["']og:published_time["']/i, label: "og:published_time" },
    { re: /name=["']DC\.date\.issued["'][^>]+content=["']([^"']+)["']/i, label: "DC.date.issued" },
    { re: /name=["']DC\.date["'][^>]+content=["']([^"']+)["']/i, label: "DC.date" },
    { re: /name=["']creation_date["'][^>]+content=["']([^"']+)["']/i, label: "meta:creation_date" },
    { re: /name=["']posted_date["'][^>]+content=["']([^"']+)["']/i, label: "meta:posted_date" },
  ];
  for (const { re, label } of patterns) {
    const m = html.match(re);
    if (m) results.push({ date: m[1], source: label, context: "<meta> tag" });
  }
  return results;
}

// ─── Layer 3: Microdata / time elements ─────────────────────────────────────
function extractMicrodata(html) {
  const results = [];
  const patterns = [
    { re: /itemprop=["']datePosted["'][^>]*(?:content|datetime)=["']([^"']+)["']/i, label: "itemprop:datePosted" },
    { re: /(?:content|datetime)=["']([^"']+)["'][^>]*itemprop=["']datePosted["']/i, label: "itemprop:datePosted" },
    { re: /itemprop=["']datePublished["'][^>]*(?:content|datetime)=["']([^"']+)["']/i, label: "itemprop:datePublished" },
    { re: /(?:content|datetime)=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i, label: "itemprop:datePublished" },
    { re: /<time[^>]+itemprop=["'](?:datePosted|datePublished)["'][^>]*datetime=["']([^"']+)["']/i, label: "time[itemprop]" },
    { re: /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2}[^"']{0,20})["']/ig, label: "time[datetime]" },
  ];
  for (const { re, label } of patterns) {
    const m = html.match(re);
    if (m) results.push({ date: m[1], source: label, context: "Microdata attribute" });
  }
  return results;
}

// ─── Layer 4: URL date patterns ──────────────────────────────────────────────
function extractFromUrl(url) {
  const patterns = [
    { re: /\/(\d{4})\/(\d{2})\/(\d{2})\//, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /[?&](?:date|posted|publish_date|datePosted)=(\d{4}-\d{2}-\d{2})/, build: (m) => m[1] },
    { re: /-(\d{4})(\d{2})(\d{2})[_\-.]/, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  ];
  for (const { re, build } of patterns) {
    const m = url.match(re);
    if (m) {
      const d = build(m);
      const parsed = new Date(d);
      if (!isNaN(parsed) && parsed.getFullYear() > 2010 && parsed <= new Date()) {
        return { date: d, source: "url:pattern", context: "Date found in URL path/query" };
      }
    }
  }
  return null;
}

// ─── Validate & normalize a date string ─────────────────────────────────────
function normalizeDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d)) return null;
  if (d.getFullYear() < 2000 || d > new Date()) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Main handler ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ?url= parameter" }) };
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid URL" }) };
  }

  try {
    const { body: html, headers: resHeaders } = await fetchUrl(targetUrl);

    // Run all layers
    const l1 = extractJsonLd(html);
    const l2 = extractMeta(html);
    const l3 = extractMicrodata(html);
    const l4url = extractFromUrl(targetUrl);

    // Build layer report
    const layers = [
      {
        id: 1,
        name: "JSON-LD structured data",
        description: "<script type=application/ld+json> blocks (Schema.org JobPosting)",
        found: l1.length > 0,
        results: l1,
      },
      {
        id: 2,
        name: "HTML meta tags",
        description: "article:published_time, og:published_time, meta name=date, etc.",
        found: l2.length > 0,
        results: l2,
      },
      {
        id: 3,
        name: "Microdata / time elements",
        description: "itemprop=datePosted, <time datetime=...> attributes",
        found: l3.length > 0,
        results: l3,
      },
      {
        id: 4,
        name: "URL date pattern",
        description: "Date embedded in URL path or query string",
        found: !!l4url,
        results: l4url ? [l4url] : [],
      },
    ];

    // Pick winner: first valid date across layers in priority order
    let winner = null;
    for (const layer of layers) {
      for (const r of layer.results) {
        const normalized = normalizeDate(r.date);
        if (normalized) {
          winner = { ...r, date: normalized, normalizedDate: normalized, layerId: layer.id, layerName: layer.name };
          break;
        }
      }
      if (winner) break;
    }

    // Calculate days ago
    let daysAgo = null;
    if (winner) {
      const diff = Date.now() - new Date(winner.date).getTime();
      daysAgo = Math.round(diff / 86400000);
    }

    // Check if page is likely JS-rendered (minimal HTML)
    const isJsRendered =
      html.length < 5000 ||
      (html.includes("__NEXT_DATA__") && !winner) ||
      (html.includes("window.__reactFiber") && !winner);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: targetUrl,
        winner,
        daysAgo,
        layers,
        meta: {
          htmlLength: html.length,
          isJsRendered,
          lastModifiedHeader: resHeaders["last-modified"] || null,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
