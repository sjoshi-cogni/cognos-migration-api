function renderLineage(panel) {
  let viewMode = ws().saved._lineageView || 'table';
  let autoChained = false;

  if (state.autoChain && !ws().saved.lineage && ws().rawSqlText) {
    ws().saved.lineage = parseLineage(ws().rawSqlText);
    persist();
    autoChained = true;
    logActivity('Auto-chain: Lineage from cached SQL → ' + ws().saved.lineage.length + ' relationships');
  }
  const manualChainAvailable = !state.autoChain && !ws().saved.lineage && ws().rawSqlText;

  panel.innerHTML = `
    ${autoChained ? `
      <div class="chain-banner">
        <div class="chain-icon">⚡</div>
        <div class="chain-text">
          <strong>Auto-chained from Extract step</strong> — ${ws().saved.lineage.length} relationships built from cached SQL.
          <br><small>To override, upload a different .sql file below.</small>
        </div>
      </div>` : ''}
    ${manualChainAvailable ? `
      <div class="chain-banner">
        <div class="chain-icon">⚡</div>
        <div class="chain-text">
          Cached SQL from Extract step available. Auto-chain is OFF.
          <br><small>Click to use cached SQL or upload a different .sql file.</small>
        </div>
        <button class="btn primary sm" id="use-chain-ln">Use cached SQL</button>
      </div>` : ''}
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">Upload SQL file</h3>
        ${ws().saved.lineage ? `
          <div class="graph-view-toggle">
            <button data-view="table" class="${viewMode === 'table' ? 'active' : ''}">Table</button>
            <button data-view="graph" class="${viewMode === 'graph' ? 'active' : ''}">Graph</button>
          </div>` : ''}
      </div>
      <div class="drop-zone" id="dz-lineage">
        <div class="drop-icon">↑</div>
        <div class="drop-title">Drop .sql to trace data flow</div>
        <div class="drop-sub">Builds Report → Source Table → Source Column lineage.</div>
        <input id="sql-lineage" type="file" accept=".sql" />
      </div>
      <div id="ln-chip"></div>
      <div class="buttons-row">
        <button class="btn primary" id="dl-lineage" ${ws().saved.lineage ? '' : 'disabled'}>↓ Download .xlsx</button>
        <button class="btn outline" id="clear-lineage">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Lineage map</h3></div>
      <div id="ln-preview"></div>
    </div>
  `;
  bindStepper();
  const preview = document.getElementById('ln-preview');
  const dlBtn = document.getElementById('dl-lineage');

  function paint() {
    if (!ws().saved.lineage) { preview.innerHTML = '<div class="note">Upload .sql or use auto-chain.</div>'; return; }
    const rows = ws().saved.lineage;
    if (viewMode === 'graph') {
      preview.innerHTML = `<div class="note success">✓ ${rows.length} lineage relationships rendered as graph.</div>` + renderLineageGraph(rows);
    } else {
      preview.innerHTML = `<div class="note success">✓ Lineage built for ${rows.length} relationships.</div><div id="ln-tbl"></div>`;
      renderSearchableTable(document.getElementById('ln-tbl'), rows, ['Report', 'Source Table', 'Source Column']);
    }
  }
  paint();

  document.querySelectorAll('.graph-view-toggle button').forEach(b => b.addEventListener('click', () => {
    viewMode = b.dataset.view;
    ws().saved._lineageView = viewMode;
    persist(); renderPage();
  }));

  if (autoChained) renderNav();

  const manLnBtn = document.getElementById('use-chain-ln');
  if (manLnBtn) manLnBtn.addEventListener('click', () => {
    ws().saved.lineage = parseLineage(ws().rawSqlText);
    persist(); renderPage(); renderNav();
    toast('Lineage built from cached SQL', 'success');
  });

  attachDropZone('dz-lineage', 'sql-lineage', async (file) => {
  document.getElementById('ln-chip').innerHTML = fileChip(file.name);
  preview.innerHTML = '<div class="note">⏳ Calling API...</div>';
  try {
    const fd = new FormData();
    fd.append('files', file);
    const data = await apiPost('/stage1/extract-lineage', fd);
    ws().saved.lineage = data.rows;
    persist(); paint(); dlBtn.disabled = false; renderNav();
    logActivity('Lineage: ' + data.total_rows + ' relationships');
    toast('Lineage built: ' + data.total_rows + ' rows', 'success');
  } catch (err) {
    toast('API error: ' + err.message, 'error');
  }
  });


  dlBtn.addEventListener('click', () => { if (ws().saved.lineage) saveWorkbook(ws().saved.lineage, 'lineage_output.xlsx'); });

  document.getElementById('clear-lineage').addEventListener('click', () => {
    delete ws().saved.lineage;
    persist(); renderPage(); renderNav();
  });
}

function renderLineageGraph(rows) {
  const reports = Array.from(new Set(rows.map(r => r.Report)));
  const tables  = Array.from(new Set(rows.map(r => r['Source Table'])));
  const columns = Array.from(new Set(rows.map(r => r['Source Column'])));
  const colWidth = 220, rowHeight = 36, padding = 24;
  const height = Math.max(reports.length, tables.length, columns.length) * rowHeight + padding * 2;
  const totalWidth = padding + colWidth * 3 + padding;
  const x1 = padding + 60, x2 = padding + colWidth + 60, x3 = padding + colWidth * 2 + 60;
  const rY = r => padding + reports.indexOf(r) * rowHeight + rowHeight / 2;
  const tY = t => padding + tables.indexOf(t)  * rowHeight + rowHeight / 2;
  const cY = c => padding + columns.indexOf(c) * rowHeight + rowHeight / 2;

  const links = rows.flatMap(r => [
    { x1, y1: rY(r.Report), x2, y2: tY(r['Source Table']) },
    { x1: x2, y1: tY(r['Source Table']), x2: x3, y2: cY(r['Source Column']) },
  ]);

  const nodeBox = (x, y, label, cls) => `
    <g>
      <rect x="${x - 60}" y="${y - 13}" width="180" height="26" rx="6" class="${cls}" stroke-width="1.5"/>
      <text x="${x + 28}" y="${y + 4}" text-anchor="middle" class="graph-label">${escapeHtml(truncate(label, 22))}</text>
    </g>`;

  return `
    <div class="lineage-graph">
      <svg width="${totalWidth}" height="${height}">
        <text x="${x1+28}" y="14" text-anchor="middle" class="graph-label" font-weight="700" fill="var(--accent)">REPORT</text>
        <text x="${x2+28}" y="14" text-anchor="middle" class="graph-label" font-weight="700" fill="var(--accent-3)">SOURCE TABLE</text>
        <text x="${x3+28}" y="14" text-anchor="middle" class="graph-label" font-weight="700" fill="var(--warn)">SOURCE COLUMN</text>
        ${links.map(l => `<path class="graph-link" d="M ${l.x1+120} ${l.y1} C ${(l.x1+l.x2)/2+60} ${l.y1}, ${(l.x1+l.x2)/2+60} ${l.y2}, ${l.x2-60} ${l.y2}"/>`).join('')}
        ${reports.map(r => nodeBox(x1, rY(r), r, 'graph-node-report')).join('')}
        ${tables.map(t  => nodeBox(x2, tY(t), t, 'graph-node-table')).join('')}
        ${columns.map(c => nodeBox(x3, cY(c), c, 'graph-node-column')).join('')}
      </svg>
    </div>`;
}
