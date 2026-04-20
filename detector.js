/**
 * Job Date Finder — detector.js
 *
 * Modified to bypass CORS issues using the custom Netlify serverless function.
 * Fetches data via `/.netlify/functions/fetch-job` and renders the payload.
 */

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
      <span>Sending URL to Netlify Serverless Function...</span>
    </div>`;

  try {
    const proxyUrl = `/.netlify/functions/fetch-job?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    const json = await res.json();
    
    if (!res.ok) throw new Error(json.error || `Proxy returned HTTP ${res.status}`);

    // Map backend layers back into frontend UI expected format
    const uiLayers = json.layers.map(l => {
      let detail = l.description;
      let date = null;
      let source = null;
      if (l.found && l.results.length > 0) {
        detail = `Found: ${l.results[0].context}`;
        date = l.results[0].date;
        source = l.results[0].source;
      } else {
        detail = 'No matching date found in this layer';
      }
      return {
        num: '0' + l.id,
        name: l.name,
        found: l.found,
        detail: detail,
        date: date,
        source: source
      };
    });

    const uiWinner = json.winner ? {
      date: json.winner.normalizedDate || json.winner.date,
      source: json.winner.source,
    } : null;

    renderResult(uiLayers, uiWinner, json.meta);

  } catch (err) {
    renderError(err.message);
  }

  btn.disabled = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDisplay(isoDate) {
  // Try passing directly. Sometimes isoDate gives us '2024-05-15T00...'.
  // We append T12:00:00 just to keep the JS parser from shifting local timezone if it's purely YYYY-MM-DD
  const isoStr = isoDate.includes('T') ? isoDate : isoDate + 'T12:00:00';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function daysAgo(isoDate) {
  const isoStr = isoDate.includes('T') ? isoDate : isoDate + 'T12:00:00';
  const d    = new Date(isoStr);
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
function renderResult(layers, winner, meta) {
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
    let extraContext = "This usually means the page is JavaScript-rendered (SPA) — the HTML source is a blank shell and the date loads via API after the browser executes JS. Sites like Greenhouse, Workday, and Lever do this.";
    
    if (meta && meta.isJsRendered) {
      extraContext = "⚠️ We detected a JS-Rendered application (like React/Next.js/SPA). Dates are likely injected by client-side APIs, which requires a headless browser (Puppeteer/Playwright) to detect.";
    }

    out.innerHTML = `
      <div class="no-date-block">
        No date found across all 4 layers.
        <div style="margin-top:8px;font-size:12px; color: var(--danger)">
          ${extraContext}
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
  document.getElementById('result-area').innerHTML = `
    <div class="error-block">
      <div class="error-title">Could not fetch page from Serverless Function</div>
      ${escapeHtml(msg)}
      <div class="error-hint">The Netlify serverless function failed to return data. It may have hit a timeout or the site actively blocked the server-side proxy.</div>
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
