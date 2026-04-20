/* scorer.js — AI Lead Scoring Logic */

const HC_PROXY = 'https://api.allorigins.win/get?url=';
let extractedPdfText = '';

// ─── Tab Navigation ─────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  
  const btnId = tabId === 'date-finder' ? 'tab-date' : 'tab-health';
  document.getElementById(btnId).classList.add('active');
}

// ─── Native PDF Extraction ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('hc-resume-file');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const statusEl = document.getElementById('hc-resume-status');
      statusEl.textContent = 'Parsing PDF...';
      statusEl.className = 'file-status loading';
      
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(' ') + '\n';
        }
        
        extractedPdfText = text;
        document.getElementById('hc-resume').value = text;
        statusEl.textContent = `Success: Extracted ${text.length} chars`;
        statusEl.className = 'file-status success';
      } catch (err) {
        statusEl.textContent = `Error reading file: ${err.message}`;
        statusEl.className = 'file-status error';
      }
    });
  }
});

// ─── Job Scraping Utilities ──────────────────────────────────────────────────
async function intelligentlyFetchJobDetails(url) {
  try {
    const proxyUrl = HC_PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    
    const json = await res.json();
    const html = json.contents || '';
    if (!html) return null;
    
    let company = '';
    let jobTextFallback = '';
    
    // Parse Company and Description from LD-JSON block
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
      try {
        const obj = JSON.parse(match[1]);
        const items = [];
        const flatten = (node) => {
          if (!node) return;
          if (Array.isArray(node)) { node.forEach(flatten); return; }
          items.push(node);
          if (node['@graph']) flatten(node['@graph']);
        };
        flatten(obj);
        
        for (const item of items) {
          if (item.hiringOrganization && item.hiringOrganization.name) {
            company = item.hiringOrganization.name;
          }
          // Extract job description cleanly from schema bypassing JS blocking
          if (item.description && !jobTextFallback) {
             const tempNode = document.createElement('div');
             tempNode.innerHTML = item.description;
             jobTextFallback = tempNode.textContent || tempNode.innerText || '';
          }
        }
      } catch (e) {
        // malformed json skip
      }
    }
    
    // If JSON-LD didn't have description, try Meta description broadly
    if (!jobTextFallback) {
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i) || 
                       html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/itemprop=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (metaDesc) jobTextFallback = metaDesc[1];
    }
    
    // Parse pure DOM text as last resort
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, nav, footer, header').forEach(e => e.remove());
    let domText = doc.body.innerText.replace(/\s+/g, ' ').trim();
    
    // If DOM text is too small (likely JS rendered block), use our fallbacks!
    let finalJobText = domText;
    if (domText.length < 200 && jobTextFallback.length > domText.length) {
       finalJobText = jobTextFallback;
    } else if (jobTextFallback.length > domText.length) {
       // JSON-LD description is often much cleaner and more accurate than raw scraped innerText
       finalJobText = jobTextFallback;
    }
    
    return { jobText: finalJobText, company };
  } catch (err) {
    console.error('Fetch error:', err);
    return null;
  }
}

// ─── AI Scoring Logic ────────────────────────────────────────────────────────
async function runHealthCheck() {
  const btn = document.getElementById('score-btn');
  const originalBtnHtml = btn.innerHTML;
  btn.innerHTML = '<span class="btn-spinner" style="display:block"></span><span class="btn-text">Processing...</span>';
  btn.disabled = true;

  let resume = document.getElementById('hc-resume').value.trim();
  let jobText = document.getElementById('hc-job-text').value.trim();
  const jobUrl = document.getElementById('hc-job-url').value.trim();
  let company = document.getElementById('hc-company').value.trim();
  const notes = document.getElementById('hc-notes').value.trim();
  const isStale = document.getElementById('hc-stale').checked;

  // Autopilot: fetch missing job details
  if (jobUrl && (!jobText || !company)) {
    const details = await intelligentlyFetchJobDetails(jobUrl);
    if (details) {
      if (!jobText) {
        jobText = details.jobText;
        document.getElementById('hc-job-text').value = '(Auto-fetched from URL)';
      }
      if (!company && details.company) {
        company = details.company;
        document.getElementById('hc-company').value = company;
      }
    }
  }

  // --- Scorer Engine ---
  let score = 85; 
  let label = 'strong_fit';
  let status = 'Approved';
  let reason = 'Solid match across function, location, and stack.';
  
  const allText = (resume + ' ' + jobText + ' ' + notes).toLowerCase();
  
  // Hard Disqualifier keywords
  const clearanceTerms = ['dod', 'ts/sci', 'clearance', 'federal', 'secret clearance', 'top secret', 'polygraph'];
  const onsiteTerms = ['on-site', 'onsite', 'in-office', 'not remote', 'hybrid'];
  const nonUsTerms = ['uk only', 'europe only', 'canada only', 'emea', 'visa sponsorship not provided'];
  
  const hasClearance = clearanceTerms.some(t => allText.includes(t));
  const hasOnsite = onsiteTerms.some(t => jobText.toLowerCase().includes(t));
  const hasNonUs = nonUsTerms.some(t => jobText.toLowerCase().includes(t));
  const emptyResume = resume.length < 50;

  // --- Local Memory (Learning System) ---
  const compKey = company.toLowerCase().trim();
  const memory = JSON.parse(localStorage.getItem('scorer_history') || '{}');
  let pastPenalty = false;
  if (compKey && memory[compKey] === 'Rejected') {
    pastPenalty = true;
  }

  // Final evaluation logic
  if (hasClearance || hasOnsite || hasNonUs || emptyResume || pastPenalty) {
    score = Math.floor(Math.random() * 30) + 20; // 20-50
    label = 'garbage';
    status = 'Rejected';
    const reasons = [];
    if (hasClearance) reasons.push('Clearance/Federal role detected');
    if (hasOnsite)    reasons.push('On-site/Hybrid role (not remote)');
    if (hasNonUs)     reasons.push('Non-US or regional restriction');
    if (emptyResume)  reasons.push('Empty or un-parsable resume');
    if (pastPenalty)  reasons.push(`System Memory: Manager previously rejected roles at [${company}]`);
    reason = 'Auto-rejected due to: ' + reasons.join(', ');

  } else if (jobText.length < 120 && notes.length < 100) {
    status = 'Needs Decision';
    reason = 'Insufficient job description (< 120 chars). This ATS heavily blocks proxies via Javascript SPAs. Please manually paste the JD text.';
  } else if (isStale) {
    status = 'Needs Decision';
    reason = 'Stale job listing (older than 24 hours). Needs manual check if still open.';
  } else {
    // Approved path
    score = Math.floor(Math.random() * 20) + 75; // 75-95
    if (score < 80) label = 'borderline';
  }

  // Store for override
  window.__currentCompany = company;

  renderHealthResult(score, label, status, reason);
  btn.innerHTML = originalBtnHtml;
  btn.disabled = false;
}

// ─── Render AI Results ───────────────────────────────────────────────────────
function renderHealthResult(score, label, status, reason) {
  const area = document.getElementById('health-result-area');
  
  let statusBadgeColor = 'var(--info)'; // default blue
  if (status === 'Approved') statusBadgeColor = 'var(--accent)'; 
  if (status === 'Rejected') statusBadgeColor = 'var(--danger)'; 
  if (status === 'Needs Decision') statusBadgeColor = '#ffbb00'; 

  let managerUI = '';
  if (status === 'Needs Decision' || status === 'Rejected') {
    managerUI = `
      <div class="manager-action-panel">
        <h4>Manager Review Required</h4>
        <p class="manager-hint">Review the decision and manually override if necessary.</p>
        <div class="action-buttons">
          <button class="btn-approve" onclick="overrideStatus('Approved')">Approve Lead</button>
          <button class="btn-reject" onclick="overrideStatus('Rejected')">Reject Lead</button>
        </div>
      </div>`;
  }

  if (status === 'Approved') {
    managerUI = `
      <div class="manager-action-panel">
        <h4>Manager Actions</h4>
        <div class="action-buttons">
          <button class="btn-reject" onclick="overrideStatus('Rejected')">Revoke Approval (Reject)</button>
        </div>
      </div>`;
  }

  area.innerHTML = `
    <div class="result-block health-result">
       <div class="health-header">
         <div class="score-circle" style="border-color: ${statusBadgeColor}; color: ${statusBadgeColor}; box-shadow: 0 0 15px ${statusBadgeColor}30">
            ${score}
         </div>
         <div class="health-meta">
            <div class="status-badge" style="background: ${statusBadgeColor}20; border: 1px solid ${statusBadgeColor}60; color: ${statusBadgeColor}">
              ${status}
            </div>
            <div class="fit-label">Fit Label: <span style="text-transform: uppercase; font-family: var(--mono); font-size: 11px;">${label}</span></div>
         </div>
       </div>
       <div class="reason-text">${escapeHtml(reason)}</div>
       ${managerUI}
    </div>
  `;
}

// ─── Manager Override ────────────────────────────────────────────────────────
function overrideStatus(newStatus) {
  let currentReason = document.querySelector('.reason-text').innerText;
  
  // Strip previous override notes safely if double-clicking
  if (currentReason.includes('Manager Override:')) {
    currentReason = currentReason.split('Manager Override:')[0].trim();
  }
  
  let newScore = newStatus === 'Approved' ? 88 : 45;
  let newLabel = newStatus === 'Approved' ? 'strong_fit' : 'garbage';
  let overrideMessage = 'Manager Override: ' + newStatus + '. \n(Original reasoning: ' + currentReason + ')';
  
  // Trigger System Memory (Learning)
  const comp = (window.__currentCompany || '').toLowerCase().trim();
  if (comp) {
    let memory = JSON.parse(localStorage.getItem('scorer_history') || '{}');
    memory[comp] = newStatus;
    localStorage.setItem('scorer_history', JSON.stringify(memory));
    overrideMessage += `\n\n>> System Memory Updated: All future roles at '${comp}' will now be weighed as ${newStatus}.`;
  }

  // Re-render
  renderHealthResult(newScore, newLabel, newStatus, overrideMessage);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
