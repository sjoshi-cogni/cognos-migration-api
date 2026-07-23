const APP_VERSION = 'v7';

const pages = [
  { id: 'dashboard',     title: 'Dashboard',              subtitle: 'Overview of your BI transformation pipeline.',             icon: 'D', nav: 'Workspace' },
  { id: 'extract',       title: 'Extract Metadata',       subtitle: 'Parse .sql files to extract report name, ID, and query.', icon: 'E', nav: 'Pipeline', input: '.sql',        output: '.xlsx' },
  { id: 'mapping',       title: 'Mapping',                subtitle: 'Map legacy tables and columns to Databricks.',             icon: 'M', nav: 'Pipeline', input: '.xlsx',       output: '.xlsx' },
  { id: 'mquery',        title: 'M-Query Generation',     subtitle: 'Auto-generate Power Query (M) code for transformation.',  icon: 'Q', nav: 'Pipeline', input: '.sql / .txt', output: '.txt' },
  { id: 'aivalidation',  title: 'M-Query AI Validation',  subtitle: 'Fix and validate M-Query SQL using Databricks AI.',       icon: 'A', nav: 'Pipeline', input: 'auto',        output: '.txt' },
  { id: 'datavalidation', title: 'Data Validation',       subtitle: 'Coming soon.',                                            icon: 'V', nav: 'Pipeline', comingSoon: true },
  { id: 'fmlineage',     title: 'FM Lineage',             subtitle: 'Coming soon.',                                            icon: 'F', nav: 'Pipeline', comingSoon: true },
];



const pipelineIds = pages.filter(p => p.id !== 'dashboard').map(p => p.id);

function init() {
  load();
  document.body.setAttribute('data-theme', state.theme);
  document.getElementById('root').innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">BI</div>
        <div class="brand-text"><span class="brand-name">BI Studio</span><span class="brand-sub">Transformation Pipeline</span></div>
      </div>
      <div class="workspace-switch" id="ws-switch"></div>
      <div id="sidebar-nav"></div>
      <div class="sidebar-footer" id="sidebar-footer"></div>
    </aside>
    <main class="content" id="content"></main>
  `;
  renderWorkspaceSwitch();
  renderNav();
  renderFooter();
  renderPage();
  window.addEventListener('beforeunload', persist);
}

function renderWorkspaceSwitch() {
  const el = document.getElementById('ws-switch');
  const keys = Object.keys(state.workspaces);
  el.innerHTML = `
    <select id="ws-select">${keys.map(k => `<option value="${k}" ${k === state.activeWorkspace ? 'selected' : ''}>${escapeHtml(state.workspaces[k].name)}</option>`).join('')}</select>
    <button id="ws-new" title="New workspace">+</button>
    <button id="ws-manage" title="Manage workspaces">⋯</button>
  `;
  document.getElementById('ws-select').addEventListener('change', e => {
    state.activeWorkspace = e.target.value; persist(); renderNav(); renderPage();
    toast('Switched to ' + ws().name, 'info');
  });
  document.getElementById('ws-new').addEventListener('click', newWorkspace);
  document.getElementById('ws-manage').addEventListener('click', manageWorkspaces);
}

function newWorkspace() {
  openModal(`
    <h3>Create new workspace</h3>
    <p>A workspace stores its own pipeline runs, mappings, rules, and history.</p>
    <label class="field">Workspace name<input class="input" id="ws-name" placeholder="e.g. Q1-Migration" /></label>
    <div class="modal-actions">
      <button class="btn outline" id="ws-cancel">Cancel</button>
      <button class="btn primary" id="ws-create">Create</button>
    </div>
  `);
  document.getElementById('ws-cancel').addEventListener('click', closeModal);
  document.getElementById('ws-create').addEventListener('click', () => {
    const name = document.getElementById('ws-name').value.trim();
    if (!name) { toast('Name required', 'warn'); return; }
    const id = 'ws-' + Date.now();
    state.workspaces[id] = defaultWorkspace(name);
    state.activeWorkspace = id;
    persist(); closeModal(); renderWorkspaceSwitch(); renderNav(); renderPage();
    toast('Created workspace ' + name, 'success');
  });
}

function manageWorkspaces() {
  const keys = Object.keys(state.workspaces);
  openModal(`
    <h3>Manage workspaces</h3>
    <div>${keys.map(k => `
      <div class="rule-row">
        <input class="input rule-name" data-id="${k}" value="${escapeHtml(state.workspaces[k].name)}" />
        <button class="btn danger sm" data-del="${k}" ${keys.length === 1 ? 'disabled' : ''}>Delete</button>
      </div>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn outline" id="ws-close">Close</button>
      <button class="btn primary" id="ws-save">Save names</button>
    </div>
  `);
  document.getElementById('ws-close').addEventListener('click', closeModal);
  document.getElementById('ws-save').addEventListener('click', () => {
    document.querySelectorAll('.rule-name').forEach(inp => { state.workspaces[inp.dataset.id].name = inp.value.trim() || 'Untitled'; });
    persist(); closeModal(); renderWorkspaceSwitch(); toast('Workspaces saved', 'success');
  });
  document.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.del;
    if (Object.keys(state.workspaces).length <= 1) return;
    if (!confirm('Delete workspace "' + state.workspaces[id].name + '"?')) return;
    delete state.workspaces[id];
    if (state.activeWorkspace === id) state.activeWorkspace = Object.keys(state.workspaces)[0];
    persist(); closeModal(); renderWorkspaceSwitch(); renderNav(); renderPage();
    toast('Workspace deleted', 'success');
  }));
}

// function renderNav() {
//   const el = document.getElementById('sidebar-nav');
//   const groups = {};
//   pages.forEach(p => { groups[p.nav] = groups[p.nav] || []; groups[p.nav].push(p); });
//   el.innerHTML = Object.entries(groups).map(([label, items]) => `
//     <div class="nav-label">${label}</div>
//     ${items.map(p => `
//       <div class="step-item${p.id === state.activeId ? ' active' : ''}" data-id="${p.id}">
//         <div class="step-icon">${p.icon}</div>
//         <div class="step-info">
//           <div class="step-title">${p.title}</div>
//           <div class="step-subtitle">${p.id === 'dashboard' ? 'Home' : (p.input || '') + ' → ' + (p.output || '')}</div>
//         </div>
//         ${p.id !== 'dashboard' ? `<div class="step-status${ws().saved[p.id] ? ' done' : ''}"></div>` : ''}
//       </div>`).join('')}`).join('');
//   el.querySelectorAll('.step-item').forEach(item => item.addEventListener('click', () => setActive(item.dataset.id)));
// }

function renderNav() {
  const el = document.getElementById('sidebar-nav');
  const groups = {};
  pages.forEach(p => { groups[p.nav] = groups[p.nav] || []; groups[p.nav].push(p); });
  el.innerHTML = Object.entries(groups).map(([label, items]) => `
    <div class="nav-label">${label}</div>
    ${items.map(p => p.comingSoon ? `
      <div class="step-item coming-soon" title="Coming soon" style="opacity:0.4; cursor:not-allowed; pointer-events:none;">
        <div class="step-icon" style="background:var(--surface-3);">${p.icon}</div>
        <div class="step-info">
          <div class="step-title">${p.title}</div>
          <div class="step-subtitle">Coming soon</div>
        </div>
        <div class="step-status" style="font-size:10px; color:var(--text-mute);">🔒</div>
      </div>` : `
      <div class="step-item${p.id === state.activeId ? ' active' : ''}" data-id="${p.id}">
        <div class="step-icon">${p.icon}</div>
        <div class="step-info">
          <div class="step-title">${p.title}</div>
          <div class="step-subtitle">${p.id === 'dashboard' ? 'Home' : (p.input || '') + ' → ' + (p.output || '')}</div>
        </div>
        ${p.id !== 'dashboard' ? `<div class="step-status${ws().saved[p.id] ? ' done' : ''}"></div>` : ''}
      </div>`).join('')}`).join('');
  el.querySelectorAll('.step-item:not(.coming-soon)').forEach(item => item.addEventListener('click', () => setActive(item.dataset.id)));
}


function renderFooter() {
  const el = document.getElementById('sidebar-footer');
  el.innerHTML = `
    <div class="usage-btn" id="usage-btn">
      <span>📖</span><span>Usage & Benefits</span>
    </div>
    <div class="theme-toggle" id="theme-toggle">
      <span>${state.theme === 'dark' ? '🌙' : '☀'} ${state.theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>
      <span class="theme-switch"></span>
    </div>
    <div class="sidebar-meta">${APP_VERSION} · Databricks toolkit</div>
  `;
  document.getElementById('usage-btn').addEventListener('click', openUsageModal);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', state.theme);
    persist(); renderFooter(); toast('Theme: ' + state.theme, 'info');
  });
}

function openUsageModal() {
  const steps = [
    {
      icon: 'E', color: 'var(--accent)', title: 'Step 1 — Extract Metadata',
      how: 'Drop one or more <code>.sql</code> files. The tool parses every query, extracts report names, source tables, and source columns in one pass, and produces two Excel files: <strong>Final_Base_Tables</strong> and <strong>Final_Base_Tables_Columns</strong>.',
      benefit: 'This step reduces that effort by <strong>70–90%</strong>, completing the same work in seconds with zero missed references.',
    },
    {
      icon: 'M', color: 'var(--accent-2)', title: 'Step 2 — Mapping',
      how: 'The <code>Final_Base_Tables_Columns</code> file from Step 1 is auto-loaded. Click <strong>Run Mapping</strong> — the tool queries Databricks to resolve every Cognos table to its Unity Catalog equivalent, then uses TF-IDF + fuzzy matching (Hungarian algorithm) to match each source column to the closest target column, with a confidence score.',
      benefit: 'This step reduces that effort by <strong>50–60%</strong>, handling it automatically in minutes with confidence scores flagging anything that needs human review.',
    },
    {
      icon: 'Q', color: 'var(--accent-3)', title: 'Step 3 — M-Query Generation',
      how: 'Upload the original <code>.sql</code> files. The converter rewrites each SQL query into Power Query M syntax compatible with Power BI, handling joins, filters, aliases, and subqueries. Results download as a ZIP of <code>.txt</code> files, one per report.',
      benefit: 'Rewriting SQL to M-Query by hand requires knowledge of both languages and takes <strong>30–60 minutes per report</strong>. This step reduces that effort by <strong>50%</strong>, generating all M-Queries in one batch instead of hundreds of hours of developer time.',
    },
    {
      icon: 'A', color: 'var(--warn)', title: 'Step 4 — M-Query AI Validation',
      how: 'The generated M-Queries are sent to a Databricks-hosted LLM which checks for syntax errors, invalid references, and logic issues. Each file gets a pass/fail result with an AI-fixed version where possible.',
      benefit: 'Manual QA of generated code requires a developer to test each query in Power BI Desktop. AI validation catches the majority of issues <strong>before deployment</strong>, reducing back-and-forth cycles between migration and QA teams from weeks to hours.',
    },
  ];

  const html = `
    <h3 style="margin:0 0 4px;">📖 Usage & Benefits</h3>
    <p style="margin:0 0 20px;">How each pipeline stage works and the time it saves vs. manual effort.</p>
    <div class="usage-steps">
      ${steps.map(s => `
        <div class="usage-step">
          <div class="usage-step-header">
            <div class="usage-step-icon" style="background:${s.color};">${s.icon}</div>
            <strong>${s.title}</strong>
          </div>
          <div class="usage-section-label">How to use</div>
          <div class="usage-text">${s.how}</div>
          <div class="usage-section-label" style="color:var(--success);">vs. Manual effort</div>
          <div class="usage-text">${s.benefit}</div>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions"><button class="btn primary" id="usage-close">Got it</button></div>
  `;

  openModal(html);
  document.querySelector('#modal-container .modal-card').style.maxWidth = '780px';
  document.getElementById('usage-close').addEventListener('click', closeModal);
}

function setActive(id) {
  state.activeId = id; persist(); renderNav(); renderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// function renderStepper(currentId) {
//   return `<div class="stepper">${pipelineIds.map((id, i) => {
//     const p = pages.find(x => x.id === id);
//     const done = !!ws().saved[id], current = id === currentId;
//     return `<div class="stepper-item${current ? ' current' : ''}${done ? ' done' : ''}" data-id="${id}">
//       <div class="stepper-num">${done && !current ? '✓' : (i + 1)}</div>
//       <span>${p.title}</span>
//     </div>`;
//   }).join('')}</div>`;
// }

function renderStepper(currentId) {
  return `<div class="stepper">${pages.filter(p => p.id !== 'dashboard').map((p, i) => {
    const done = !!ws().saved[p.id], current = p.id === currentId;
    if (p.comingSoon) return `
      <div class="stepper-item" style="opacity:0.35; cursor:not-allowed; pointer-events:none;" title="Coming soon">
        <div class="stepper-num">🔒</div>
        <span>${p.title}</span>
      </div>`;
    return `
      <div class="stepper-item${current ? ' current' : ''}${done ? ' done' : ''}" data-id="${p.id}">
        <div class="stepper-num">${done && !current ? '✓' : (i + 1)}</div>
        <span>${p.title}</span>
      </div>`;
  }).join('')}</div>`;
}


function bindStepper() {
  document.querySelectorAll('.stepper-item').forEach(el => el.addEventListener('click', () => setActive(el.dataset.id)));
}

function renderPage() {
  const content = document.getElementById('content');
  const page = pages.find(p => p.id === state.activeId);
  if (page.id === 'dashboard') { content.innerHTML = renderDashboard(); bindDashboard(); return; }

  content.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-badge">${(page.input || '').toUpperCase()} &rarr; ${(page.output || '').toUpperCase()}</div>
        <h1 class="page-title">${page.title}</h1>
        <p class="page-subtitle">${page.subtitle}</p>
      </div>
      <div class="head-actions"><button class="btn outline sm" id="exp-audit">Export audit ZIP</button></div>
    </div>
    ${renderStepper(page.id)}
    <div id="step-panel"></div>
    <div class="footer-nav">
      <button class="btn outline" id="prev-step">&larr; Previous step</button>
      <button class="btn primary" id="next-step">Next step &rarr;</button>
    </div>
  `;
  document.getElementById('exp-audit').addEventListener('click', exportAuditZip);
  const idx = pipelineIds.indexOf(page.id);
  document.getElementById('prev-step').addEventListener('click', () => setActive(idx === 0 ? 'dashboard' : pipelineIds[idx - 1]));
  const nextBtn = document.getElementById('next-step');
  nextBtn.disabled = idx === pipelineIds.length - 1;
  nextBtn.addEventListener('click', () => setActive(pipelineIds[Math.min(pipelineIds.length - 1, idx + 1)]));

  const panel = document.getElementById('step-panel');
  switch (page.id) {
    case 'extract':      renderExtract(panel);      break;
    case 'mapping':      renderMapping(panel);      break;
    case 'mquery':       renderMQuery(panel);       break;
    case 'aivalidation': renderAIValidation(panel); break;
  }

}

function renderDashboard() {
  const completed = pipelineIds.filter(id => ws().saved[id]).length;
  const total = pipelineIds.length;
  const pct = Math.round((completed / total) * 100);
  const countMappings = () => { const m = ws().saved.mapping; return m ? (m.table||[]).length + (m.column||[]).length : 0; };
  const valSummary = () => { const s = ws().saved.aivalidation; if (!s) return ''; return s.results.filter(r => r.llm_success).length + ' / ' + s.total_files + ' AI fixed'; };
  return `
    <div class="page-head">
      <div>
        <div class="page-badge">Workspace: ${escapeHtml(ws().name)}</div>
        <h1 class="page-title">Welcome back</h1>
        <p class="page-subtitle">Monitor your transformation pipeline from legacy systems to Databricks.</p>
      </div>
      <div class="head-actions">
        <button class="btn outline sm" id="exp-audit">Export audit ZIP</button>
        <button class="btn outline sm" id="clear-ws">Reset this workspace</button>
        <button class="btn danger sm" id="nuke-all">Nuke everything</button>
      </div>
    </div>
    <div class="quick-start">
      <h2>Start a new transformation</h2>
      <div class="quick-actions">
        <button class="btn secondary" id="qs-start" style="background:rgba(0,0,0,0.25);color:white;">Begin pipeline →</button>
        <button class="btn secondary" id="qs-dvs" style="background:rgba(0,0,0,0.25);color:white;">Run AI validation →</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Pipeline progress</div><div class="kpi-value">${pct}%</div><div class="kpi-trend">${completed} of ${total} stages complete</div></div>
      <div class="kpi-card"><div class="kpi-label">Reports extracted</div><div class="kpi-value">${(ws().saved.extract||[]).length}</div><div class="kpi-trend flat">${ws().saved.extract ? 'metadata ready' : 'no extraction yet'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Mapped objects</div><div class="kpi-value">${countMappings()}</div><div class="kpi-trend flat">tables + columns</div></div>
      <div class="kpi-card"><div class="kpi-label">AI Validation</div><div class="kpi-value">${ws().saved.aivalidation ? 'Ready' : 'Pending'}</div><div class="kpi-trend flat">${ws().saved.aivalidation ? valSummary() : 'awaiting AI fix'}</div></div>

    </div>
    <div class="dash-grid">
      <div class="dash-card">
        <h3>Pipeline stages</h3>
        ${pipelineIds.map((id, i) => { const p = pages.find(x => x.id === id); const done = !!ws().saved[id]; return `
          <div class="pipeline-row${done ? ' done' : ''}" data-id="${id}">
            <div class="pipeline-num">${done ? '✓' : i+1}</div>
            <div class="pipeline-name">${p.title}</div>
            <div class="pipeline-meta">${p.input} → ${p.output}</div>
            <span class="pill ${done ? 'passed' : 'warn'}">${done ? 'done' : 'pending'}</span>
          </div>`; }).join('')}
      </div>
      <div class="dash-card">
        <h3>Recent activity</h3>
        ${ws().activity.length
          ? ws().activity.map(a => `<div class="activity-item"><div class="activity-dot"></div><div><div class="activity-text">${escapeHtml(a.text)}</div><div class="activity-time">${fmtTime(a.time)}</div></div></div>`).join('')
          : '<div class="note">No activity yet.</div>'}
      </div>
    </div>
  `;
}

function bindDashboard() {
  document.getElementById('qs-start').addEventListener('click', () => setActive('extract'));
  document.getElementById('qs-dvs').addEventListener('click', () => setActive('aivalidation'));
  document.getElementById('exp-audit').addEventListener('click', exportAuditZip);
  document.getElementById('clear-ws').addEventListener('click', () => {
    if (!confirm('Reset all stage outputs and activity for this workspace?')) return;
    state.workspaces[state.activeWorkspace] = defaultWorkspace(ws().name);
    persist(); renderNav(); renderPage(); toast('Workspace reset', 'success');
  });
  document.getElementById('nuke-all').addEventListener('click', () => {
    if (!confirm('NUKE all data? Cannot be undone.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    state.workspaces = { default: defaultWorkspace('Default') };
    state.activeWorkspace = 'default'; state.activeId = 'dashboard';
    persist(); toast('All data nuked.', 'success');
    setTimeout(() => location.reload(), 500);
  });
  document.querySelectorAll('.pipeline-row').forEach(row => row.addEventListener('click', () => setActive(row.dataset.id)));
}

function openAIModal() {
  openModal(`
    <h3>AI Assistant</h3>
    <p>Search across extracted reports, lineage, and mappings.</p>
    <div class="flex-row">
      <input class="input" id="ai-input" placeholder="e.g. which reports use the customer table?" style="flex:1;" />
      <button class="btn primary" id="ai-ask">Ask</button>
    </div>
    <div id="ai-output" style="margin-top:14px;"></div>
    <div class="modal-actions"><button class="btn outline" id="ai-close">Close</button></div>
  `);
  const input = document.getElementById('ai-input');
  input.focus();
  const ask = () => {
    const q = input.value.trim(); if (!q) return;
    const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const score = (blob) => tokens.filter(t => blob.includes(t)).length;
    const hits = { extract: [], lineage: [], mapping: [] };
    if (ws().saved.extract) ws().saved.extract.forEach(r => { const s = score((r['Report Name']+' '+r['Report ID']+' '+r['Query']).toLowerCase()); if (s) hits.extract.push({ row: r, score: s }); });
    if (ws().saved.mapping) Object.entries(ws().saved.mapping).forEach(([k, arr]) => (arr||[]).forEach(r => { const s = score(Object.values(r).join(' ').toLowerCase()); if (s) hits.mapping.push({ tab: k, row: r, score: s }); }));
    Object.values(hits).forEach(a => a.sort((x, y) => y.score - x.score));
    const total = hits.extract.length + hits.lineage.length + hits.mapping.length;
    let out = total ? `Found <strong>${total}</strong> match(es).<br>` : '<em>No matches. Run Extract and Lineage steps first.</em>';
    if (hits.extract.length) out += `<strong style="color:var(--accent);">Reports (${hits.extract.length})</strong><ul class="ai-result-list">${hits.extract.slice(0,6).map(h => `<li><strong>${escapeHtml(h.row['Report Name'])}</strong> (${h.row['Report ID']})<br><span class="ai-result-meta">${escapeHtml(truncate(h.row['Query'],120))}</span></li>`).join('')}</ul>`;
    if (hits.lineage.length) out += `<strong style="color:var(--accent-3);">Lineage (${hits.lineage.length})</strong><ul class="ai-result-list">${hits.lineage.slice(0,6).map(h => `<li>${escapeHtml(h.row.Report)} → ${escapeHtml(h.row['Source Table'])} → ${escapeHtml(h.row['Source Column'])}</li>`).join('')}</ul>`;
    if (hits.mapping.length) out += `<strong style="color:var(--warn);">Mappings (${hits.mapping.length})</strong><ul class="ai-result-list">${hits.mapping.slice(0,6).map(h => `<li>[${h.tab}] ${Object.values(h.row).map(v => escapeHtml(v)).join(' → ')}</li>`).join('')}</ul>`;
    document.getElementById('ai-output').innerHTML = `<div class="ai-message user"><strong>You:</strong> ${escapeHtml(q)}</div><div class="ai-message assistant">${out}</div>`;
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  document.getElementById('ai-ask').addEventListener('click', ask);
  document.getElementById('ai-close').addEventListener('click', closeModal);
}

async function exportAuditZip() {
  if (!window.JSZip) { toast('JSZip not loaded', 'error'); return; }
  const zip = new JSZip();
  const manifest = { workspace: ws().name, generatedAt: new Date().toISOString(), stages: {} };
  const addXlsx = (rows, name) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1'); zip.file(name, XLSX.write(wb, { bookType: 'xlsx', type: 'array' })); };
  if (ws().saved.extract)     { addXlsx(ws().saved.extract, '01_extracted_reports.xlsx'); manifest.stages.extract = { rows: ws().saved.extract.length }; }
  if (ws().saved.lineage)     { addXlsx(ws().saved.lineage, '03_lineage_output.xlsx'); manifest.stages.lineage = { rows: ws().saved.lineage.length }; }
  if (ws().saved.mapping)     {
    if (ws().saved.mapping.table)  addXlsx(ws().saved.mapping.table,  '04a_table_mapping.xlsx');
    if (ws().saved.mapping.column) addXlsx(ws().saved.mapping.column, '04b_column_mapping.xlsx');
    manifest.stages.mapping = { tablePairs: (ws().saved.mapping.table||[]).length, columnPairs: (ws().saved.mapping.column||[]).length };
  }
  // AFTER
  if (ws().saved.mquery)      { manifest.stages.mquery = { files: ws().saved.mquery.total_files }; }
  if (ws().saved.aivalidation) {
    ws().saved.aivalidation.results.forEach(r => {
      if (r.fixed_mquery) zip.file('ai_fixed/' + r.output_filename, r.fixed_mquery);
    });
    manifest.stages.aivalidation = { total: ws().saved.aivalidation.total_files, fixed: ws().saved.aivalidation.results.filter(r => r.llm_success).length };
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  if (!Object.keys(manifest.stages).length) { toast('Nothing to export yet', 'warn'); return; }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'audit-' + ws().name.replace(/\s+/g, '_') + '-' + Date.now() + '.zip');
  logActivity('Exported audit ZIP (' + Object.keys(manifest.stages).length + ' stages)');
}

window.addEventListener('DOMContentLoaded', init);