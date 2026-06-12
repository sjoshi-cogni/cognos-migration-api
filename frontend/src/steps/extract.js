function renderExtract(panel) {
  panel.innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">Upload SQL file(s) — batch supported</h3>
        ${ws().saved.extract ? `<span class="pill info">${ws().saved.extract.length} reports cached</span>` : ''}
      </div>
      <div class="drop-zone" id="dz-extract">
        <div class="drop-icon">↑</div>
        <div class="drop-title">Drop one or more .sql files here</div>
        <div class="drop-sub">Each statement is parsed into Report Name, Report ID, Query, Source File.</div>
        <input id="sql-input" type="file" accept=".sql" multiple />
      </div>
      <div id="ex-chips" class="file-chips"></div>
      <div class="buttons-row">
        <button class="btn primary" id="dl-extract" ${ws().saved.extract ? '' : 'disabled'}>↓ Download .xlsx</button>
        <button class="btn outline" id="clear-extract">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Extracted reports</h3></div>
      <div id="ex-preview"></div>
    </div>
  `;
  bindStepper();
  const chips = document.getElementById('ex-chips');
  const preview = document.getElementById('ex-preview');
  const dlBtn = document.getElementById('dl-extract');

  function paint() {
    const rows = ws().saved.extract;
    if (!rows) { preview.innerHTML = '<div class="note">Upload a .sql file to begin.</div>'; return; }
    preview.innerHTML = `<div class="note success">✓ ${rows.length} extracted report(s) ready.</div><div id="ex-tbl"></div>`;
    renderSearchableTable(document.getElementById('ex-tbl'), rows, Object.keys(rows[0]), { wideCols: ['Query'] });
  }
  paint();

  attachDropZone('dz-extract', 'sql-input', async (files) => {
  chips.innerHTML = files.map(f => fileChip(f.name)).join('');
  preview.innerHTML = '<div class="note">⏳ Calling API...</div>';
  try {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const data = await apiPost('/stage1/extract-tables', fd);
    ws().saved.extract = data.tables;   // array of TableRow objects
    persist(); paint(); dlBtn.disabled = false; renderNav();
    logActivity('Extracted ' + data.total_tables + ' tables from ' + files.length + ' file(s)');
    toast('Extracted ' + data.total_tables + ' tables', 'success');
  } catch (err) {
    toast('API error: ' + err.message, 'error');
    preview.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
  }
  }, true);


  dlBtn.addEventListener('click', () => {
  if (!ws().saved.extract) return;
  const fd = new FormData();
  // re-use files from last upload — easiest to store them in a variable
  // OR just export locally since data is already in ws().saved.extract
  saveWorkbook(ws().saved.extract, 'extracted_tables.xlsx');
  });

}
