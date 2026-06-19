function renderExtract(panel) {
  let activeTab = ws().saved._extractTab || 'tables';
  let lastFiles = null;

  function html() {
    const hasExtract = !!ws().saved.extract;
    const hasLineage = !!ws().saved.lineage;
    return `
      <div class="panel">
        <div class="section-head">
          <h3 class="section-title">Upload .sql files</h3>
        </div>
        <div class="drop-zone" id="dz-extract">
          <div class="drop-icon">↑</div>
          <div class="drop-title">Drop one or more .sql files here</div>
          <div class="drop-sub">Extracts base tables and full column lineage in one pass.</div>
          <input id="sql-input" type="file" accept=".sql" multiple />
        </div>
        <div id="ex-chips" class="file-chips"></div>
        <div class="buttons-row">
          <button class="btn primary" id="dl-tables" ${hasExtract ? '' : 'disabled'}>↓ Download Final_Base_Tables.xlsx</button>
          <button class="btn primary" id="dl-lineage" ${hasLineage ? '' : 'disabled'}>↓ Download Final_Base_Tables_Columns.xlsx</button>
          <button class="btn outline" id="clear-extract">Reset</button>
        </div>
      </div>
      <div class="panel">
        <div class="section-head">
          <h3 class="section-title">Results</h3>
          <div class="graph-view-toggle">
            <button data-tab="tables" class="${activeTab === 'tables' ? 'active' : ''}">Final Base Tables ${hasExtract ? `<span class="pill info" style="margin-left:6px;">${ws().saved.extract.length}</span>` : ''}</button>
            <button data-tab="lineage" class="${activeTab === 'lineage' ? 'active' : ''}">Final Base Tables Columns ${hasLineage ? `<span class="pill info" style="margin-left:6px;">${ws().saved.lineage.length}</span>` : ''}</button>
          </div>
        </div>
        <div id="ex-preview"></div>
      </div>
    `;
  }

  function paint() {
    panel.innerHTML = html();
    bindStepper();

    // tab switcher
    panel.querySelectorAll('.graph-view-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        ws().saved._extractTab = activeTab;
        persist();
        paintPreview();
        panel.querySelectorAll('.graph-view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
      });
    });

    paintPreview();
    bindActions();
  }

  function paintPreview() {
    const preview = document.getElementById('ex-preview');
    if (!preview) return;
    if (activeTab === 'tables') {
      const rows = ws().saved.extract;
      if (!rows) { preview.innerHTML = '<div class="note">Upload .sql files to see extracted tables.</div>'; return; }
      preview.innerHTML = `<div id="ex-tbl"></div>`;
      renderSearchableTable(document.getElementById('ex-tbl'), rows, Object.keys(rows[0]));
    } else {
      const rows = ws().saved.lineage;
      if (!rows) { preview.innerHTML = '<div class="note">Upload .sql files to see lineage.</div>'; return; }
      preview.innerHTML = `<div id="ln-tbl"></div>`;
      renderSearchableTable(document.getElementById('ln-tbl'), rows, Object.keys(rows[0]));
    }
  }

  function bindActions() {
    const chips = document.getElementById('ex-chips');

    attachDropZone('dz-extract', 'sql-input', async (files) => {
      lastFiles = files;
      chips.innerHTML = files.map(f => fileChip(f.name)).join('');
      document.getElementById('ex-preview').innerHTML = '<div class="note">⏳ Calling API...</div>';
      try {
        const fd1 = new FormData(), fd2 = new FormData();
        files.forEach(f => { fd1.append('files', f); fd2.append('files', f); });
        const [d1, d2] = await Promise.all([
          apiPost('/stage1/extract-tables', fd1),
          apiPost('/stage1/extract-lineage', fd2),
        ]);
        ws().saved.extract = d1.tables;
        ws().saved.lineage = d2.rows;
        persist(); renderNav();
        logActivity('Extracted ' + d1.total_tables + ' tables, ' + d2.total_rows + ' lineage rows from ' + files.length + ' file(s)');
        toast('Done — ' + d1.total_tables + ' tables, ' + d2.total_rows + ' lineage rows', 'success');
        paint();
      } catch (err) {
        toast('API error: ' + err.message, 'error');
        document.getElementById('ex-preview').innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
      }
    }, true);

    document.getElementById('dl-tables').addEventListener('click', async () => {
      if (!lastFiles) { saveWorkbook(ws().saved.extract, 'Final_Base_Tables.xlsx'); return; }
      const fd = new FormData();
      lastFiles.forEach(f => fd.append('files', f));
      await apiDownload('/stage1/extract-tables/download', fd, 'Final_Base_Tables.xlsx');
    });

    document.getElementById('dl-lineage').addEventListener('click', async () => {
      if (!lastFiles) { saveWorkbook(ws().saved.lineage, 'Final_Base_Tables_Columns.xlsx'); return; }
      const fd = new FormData();
      lastFiles.forEach(f => fd.append('files', f));
      await apiDownload('/stage1/extract-lineage/download', fd, 'Final_Base_Tables_Columns.xlsx');
    });

    document.getElementById('clear-extract').addEventListener('click', () => {
      delete ws().saved.extract;
      delete ws().saved.lineage;
      delete ws().saved._extractTab;
      lastFiles = null;
      persist(); renderNav(); paint();
    });
  }

  paint();
}
