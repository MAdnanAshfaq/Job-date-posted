// app.js — Job Date Finder frontend

(function () {
  "use strict";

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const urlInput   = document.getElementById("url-input");
  const detectBtn  = document.getElementById("detect-btn");
  const resultSec  = document.getElementById("result-section");
  const exLinks    = document.querySelectorAll(".ex-link");

  // ── Config ──────────────────────────────────────────────────────────────────
  // When running locally (GitHub Pages / Netlify), the function is at /.netlify/functions/fetch-job
  // Netlify automatically routes this. For local dev with netlify-cli it also works.
  const API = "/.netlify/functions/fetch-job";

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function formatDate(isoDate) {
    const d = new Date(isoDate + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function formatAge(days) {
    if (days === 0) return "Posted today";
    if (days === 1) return "1 day ago";
    if (days < 7)  return `${days} days ago`;
    if (days < 14) return "1 week ago";
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 60) return "1 month ago";
    return `${Math.floor(days / 30)} months ago`;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setLoading(on) {
    detectBtn.disabled = on;
    detectBtn.classList.toggle("loading", on);
  }

  // ── Render result ───────────────────────────────────────────────────────────
  function renderResult(data) {
    const { winner, daysAgo, layers, meta } = data;

    // Winner banner
    let bannerHtml;
    if (winner) {
      bannerHtml = `
        <div class="winner-banner success">
          <div class="winner-label">Posted date detected</div>
          <div class="winner-date">${esc(formatDate(winner.date))}</div>
          <div class="winner-age">${formatAge(daysAgo)}</div>
          <div class="winner-source">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="#4ade80" stroke-width="1.5"/><path d="M3 5l1.5 1.5L7 3.5" stroke="#4ade80" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Found via ${esc(winner.source)}
          </div>
        </div>`;
    } else {
      bannerHtml = `
        <div class="winner-banner fail">
          <div class="winner-label">Result</div>
          <div class="winner-date fail">No date found</div>
          <div class="winner-source fail">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="#f87171" stroke-width="1.5"/><path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="#f87171" stroke-width="1.2" stroke-linecap="round"/></svg>
            All 4 layers returned nothing
          </div>
        </div>`;
    }

    // JS-rendered warning
    const jsWarn = meta.isJsRendered ? `
      <div class="js-warning">
        ⚠ This page appears to use JavaScript rendering (SPA/React/Next.js). The date may be loaded dynamically via API after page load — raw HTML scraping can't see it. Try right-clicking the page in your browser → View Page Source → search for <code>datePosted</code>.
      </div>` : "";

    // Layers
    const layersHtml = layers.map(layer => {
      const status = layer.found ? "found" : "miss";
      const resultsHtml = layer.results.map(r => `
        <div class="layer-result">
          <b>${esc(r.source)}</b><br/>
          Raw: ${esc(r.date)}${r.context ? `<br/>Context: ${esc(r.context)}` : ""}
        </div>`).join("");

      return `
        <div class="layer-row">
          <div class="layer-status-dot ${status}"></div>
          <div class="layer-num">0${layer.id}</div>
          <div class="layer-info">
            <div class="layer-name-row">
              <span class="layer-name">${esc(layer.name)}</span>
              ${layer.found ? '<span class="found-tag">FOUND</span>' : ""}
            </div>
            <div class="layer-detail">${esc(layer.description)}</div>
            ${resultsHtml}
          </div>
        </div>`;
    }).join("");

    // Meta row
    const metaHtml = `
      <div class="meta-row">
        <span class="meta-item">HTML size: <span>${(meta.htmlLength / 1024).toFixed(1)} KB</span></span>
        ${meta.lastModifiedHeader ? `<span class="meta-item">Last-Modified header: <span>${esc(meta.lastModifiedHeader)}</span></span>` : ""}
        <span class="meta-item">JS-rendered: <span>${meta.isJsRendered ? "likely yes" : "no"}</span></span>
      </div>`;

    resultSec.innerHTML = `
      <div class="result-card">
        ${bannerHtml}
        ${jsWarn}
        <div class="layers-section">
          <div class="layers-heading">Layer-by-layer breakdown</div>
          ${layersHtml}
        </div>
        ${metaHtml}
      </div>`;

    resultSec.classList.remove("hidden");
    resultSec.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderError(msg) {
    resultSec.innerHTML = `
      <div class="error-card">
        <div class="error-title">Request failed</div>
        <div class="error-msg">${esc(msg)}<br/><br/>
        Common causes: the site blocks automated requests, requires login, or uses heavy JS rendering (Workday, Greenhouse, Lever). In that case, view the page source manually in your browser and search for <code>datePosted</code>.</div>
      </div>`;
    resultSec.classList.remove("hidden");
  }

  // ── Main detect function ────────────────────────────────────────────────────
  async function detect() {
    const raw = urlInput.value.trim();
    if (!raw) { urlInput.focus(); return; }

    let url = raw;
    if (!url.startsWith("http")) url = "https://" + url;

    setLoading(true);
    resultSec.classList.add("hidden");

    try {
      const endpoint = `${API}?url=${encodeURIComponent(url)}`;
      const res = await fetch(endpoint);
      const data = await res.json();

      if (!res.ok || data.error) {
        renderError(data.error || `HTTP ${res.status}`);
      } else {
        renderResult(data);
      }
    } catch (err) {
      renderError(err.message || "Network error — is the Netlify function running?");
    } finally {
      setLoading(false);
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────────
  detectBtn.addEventListener("click", detect);

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") detect();
  });

  exLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      urlInput.value = btn.dataset.url;
      detect();
    });
  });
})();
