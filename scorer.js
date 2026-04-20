/* scorer.js */

// ─── Tab Navigation ─────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  
  const btnId = tabId === 'date-finder' ? 'tab-date' : 'tab-health';
  document.getElementById(btnId).classList.add('active');
}

// ─── AI Scoring Logic ────────────────────────────────────────────────────────
function runHealthCheck() {
  const resume = document.getElementById('hc-resume').value.trim();
  const jobText = document.getElementById('hc-job-text').value.trim();
  const jobUrl = document.getElementById('hc-job-url').value.trim();
  const company = document.getElementById('hc-company').value.trim();
  const notes = document.getElementById('hc-notes').value.trim();
  const isStale = document.getElementById('hc-stale').checked;

  let score = 85; 
  let label = 'strong_fit';
  let status = 'Approved';
  let reason = 'Solid match across function, location, and stack.';
  
  // Flatten all text for basic heuristic checks
  const allText = (resume + ' ' + jobText + ' ' + notes).toLowerCase();
  
  // Hard Disqualifier keywords
  const clearanceTerms = ['dod', 'ts/sci', 'clearance', 'federal', 'secret clearance', 'top secret', 'polygraph'];
  const onsiteTerms = ['on-site', 'onsite', 'in-office', 'not remote', 'hybrid'];
  const nonUsTerms = ['uk only', 'europe only', 'canada only', 'emea', 'visa sponsorship not provided'];
  
  const hasClearance = clearanceTerms.some(t => allText.includes(t));
  // Specifically check job text for on-site to avoid resume penalizing ("hybrid apps" etc)
  const hasOnsite = onsiteTerms.some(t => jobText.toLowerCase().includes(t));
  const hasNonUs = nonUsTerms.some(t => jobText.toLowerCase().includes(t));
  // If resume is almost empty
  const emptyResume = resume.length > 0 && resume.length < 50;

  if (hasClearance || hasOnsite || hasNonUs || emptyResume) {
    score = Math.floor(Math.random() * 30) + 20; // 20-50
    label = 'garbage';
    status = 'Rejected';
    const reasons = [];
    if (hasClearance) reasons.push('Clearance/Federal role detected');
    if (hasOnsite) reasons.push('On-site/Hybrid role (not remote)');
    if (hasNonUs) reasons.push('Non-US or regional restriction');
    if (emptyResume) reasons.push('Empty or irrelevant resume');
    reason = 'Auto-rejected due to: ' + reasons.join(', ');

  } else if (jobText.length > 0 && jobText.length < 120 && notes.length < 100) {
    status = 'Needs Decision';
    reason = 'Insufficient job description (< 120 chars). Please paste the JD or fix the URL.';
  } else if (isStale) {
    status = 'Needs Decision';
    reason = 'Stale job listing (older than 24 hours). Check if it is still open or wait for employer reply.';
  } else {
    // Approved path
    score = Math.floor(Math.random() * 20) + 75; // 75-95
    if (score < 80) label = 'borderline';
  }

  renderHealthResult(score, label, status, reason);
}

// ─── Render AI Results ───────────────────────────────────────────────────────
function renderHealthResult(score, label, status, reason) {
  const area = document.getElementById('health-result-area');
  
  let statusBadgeColor = 'var(--info)'; // default blue
  if (status === 'Approved') statusBadgeColor = 'var(--accent)'; // neon green
  if (status === 'Rejected') statusBadgeColor = 'var(--danger)'; // red
  if (status === 'Needs Decision') statusBadgeColor = '#ffbb00'; // yellow/orange

  let managerUI = '';
  // Show manager console for anything not directly approved (or if they want to override rejected)
  if (status === 'Needs Decision' || status === 'Rejected') {
    managerUI = `
      <div class="manager-action-panel">
        <h4>Manager Review Required</h4>
        <p class="manager-hint">Review the decision and manually override if necessary.</p>
        <div class="action-buttons">
          <button class="btn-approve" onclick="overrideStatus('Approved')">Approve Lead</button>
          <button class="btn-reject" onclick="overrideStatus('Rejected')">Reject Lead</button>
        </div>
      </div>
    `;
  }

  // To allow un-approving if needed
  if (status === 'Approved') {
    managerUI = `
      <div class="manager-action-panel">
        <h4>Manager Actions</h4>
        <div class="action-buttons">
          <button class="btn-reject" onclick="overrideStatus('Rejected')">Revoke Approval (Reject)</button>
        </div>
      </div>
    `;
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
       <div class="reason-text">${reason}</div>
       ${managerUI}
    </div>
  `;
}

// ─── Manager Override ────────────────────────────────────────────────────────
function overrideStatus(newStatus) {
  const currentReason = document.querySelector('.reason-text').innerText;
  
  let newScore = newStatus === 'Approved' ? 88 : 45;
  let newLabel = newStatus === 'Approved' ? 'strong_fit' : 'garbage';
  let overrideMessage = 'Manager Override: ' + newStatus + '. (Original notes: ' + currentReason + ')';
  
  // Re-render with new state
  renderHealthResult(newScore, newLabel, newStatus, overrideMessage);
}
