function renderRationalize(panel) {
  let autoChained = false;
  if (state.autoChain && !ws().saved.rationalize && ws().saved.extract && ws().saved.extract.length) {
    const result = processRationalize(ws().saved.extract);
    ws().saved.rationalize = result.unique;
    persist();
    autoChained = true;
    logActivity('Auto-chain: Rationalize from Extract → ' + result.unique.length + ' rows');
  }
  const manualChainAvailable = !state.autoChain && !ws().saved.rationalize && ws().saved.extract && ws().saved.extract.length;

  panel.innerHTML = `
    ${autoChained ? `
      <div class="chain-banner">
        <div class="chain-icon">⚡</div>
        <div class="chain-text">
          <strong>Auto-chained from Extract step</strong> — ${ws().saved.rationalize.length} unique rows after removing duplicates.
          <br><small>To override, upload a different .xlsx file below.</small>
        </div>
      </div>` : ''}
    ${manualChainAvailable ? `
      <div class="chain-banner">
        <div class="chain-icon">⚡</div>
        <div class="chain-text">
          Cached: <strong>${ws().saved.extract.length} reports</strong> from Extract step. Auto-chain is OFF.
          <br><small>Click below to use cached data, or upload a different file.</small>
        </div>
        <button class="btn primary sm" id="use-chain-rat">Use Extract output</button>
      </div>` : ''}
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Upload extracted .xlsx</h3></div>
      <div class="drop-zone" id="dz-rat">
        <div class="drop-icon">↑</div>
        <div class="drop-title">Drop .xlsx from Extract step</div>
        <div class="drop-sub">Duplicate rows and rows missing Name/Query will be removed.</div>
        <input id="xlsx-input" type="file" accept=".xlsx,.xls" />
      </div>
      <div id="rat-chip"></div>
      <div class="buttons-row">
        <button class="btn primary" id="dl-rat" ${ws().saved.rationalize ? '' : 'disabled'}>↓ Download .pbix</button>
        <button class="btn outline" id="clear-rat">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Rationalized output</h3></div>
      <div id="rat-preview"></div>
    </div>
  `;
  bindStepper();
  const preview = document.getElementById('rat-preview');
  const dlBtn = document.getElementById('dl-rat');

  function paint() {
    if (!ws().saved.rationalize) { preview.innerHTML = '<div class="note">Upload a file or use auto-chain.</div>'; return; }
    const rows = ws().saved.rationalize;
    preview.innerHTML = `<div class="note success">✓ ${rows.length} unique reports.</div><div id="rat-tbl"></div>`;
    renderSearchableTable(document.getElementById('rat-tbl'), rows, Object.keys(rows[0]), { wideCols: ['Query'] });
  }
  paint();

  if (autoChained) renderNav();

  const manRatBtn = document.getElementById('use-chain-rat');
  if (manRatBtn) manRatBtn.addEventListener('click', () => {
    const result = processRationalize(ws().saved.extract);
    ws().saved.rationalize = result.unique;
    persist(); renderPage(); renderNav();
    toast('Rationalized: ' + result.unique.length + ' unique rows', 'success');
  });

  attachDropZone('dz-rat', 'xlsx-input', (file) => {
    document.getElementById('rat-chip').innerHTML = fileChip(file.name);
    readWorkbook(file).then(wb => {
      const result = processRationalize(workbookToJson(wb));
      ws().saved.rationalize = result.unique;
      persist(); paint(); dlBtn.disabled = false; renderNav();
      logActivity('Rationalized ' + result.unique.length + ' reports');
      toast('Removed ' + result.dupRemoved + ' duplicates, ' + result.unusedRemoved + ' unused', 'success');
    });
  });

  dlBtn.addEventListener('click', () => {
    if (!ws().saved.rationalize) return;
    saveText(JSON.stringify({ type: 'rationalized-pbix', generatedAt: new Date().toISOString(), rows: ws().saved.rationalize }, null, 2), 'rationalized.pbix');
  });

  document.getElementById('clear-rat').addEventListener('click', () => {
    delete ws().saved.rationalize;
    persist(); renderPage(); renderNav();
  });
}
