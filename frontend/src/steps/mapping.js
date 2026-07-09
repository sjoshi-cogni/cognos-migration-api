function renderMapping(panel) {
  bindStepper();
  let activeTab = ws().saved._mappingTab || 'table';

  function rowsToXlsx(rows, sheetName) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
    return new File(
      [XLSX.write(wb, { bookType: 'xlsx', type: 'array' })],
      sheetName + '.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    );
  }

  function paintPreview() {
    const preview = document.getElementById('map-preview');
    if (!preview) return;
    const tableRows  = ws().saved.mapping?.table  || [];
    const columnRows = ws().saved.mapping?.column || [];
    const rows = activeTab === 'table' ? tableRows : columnRows;
    if (!rows.length) { preview.innerHTML = '<div class="note">No data.</div>'; return; }
    preview.innerHTML = '<div id="map-tbl"></div>';
    renderSearchableTable(document.getElementById('map-tbl'), rows, Object.keys(rows[0]));
  }

  function render() {
    const tableRows  = ws().saved.mapping?.table  || [];
    const columnRows = ws().saved.mapping?.column || [];
    const isDone     = tableRows.length > 0 && columnRows.length > 0;
    const lineageRows = ws().saved.lineage || [];
    const hasLineage  = lineageRows.length > 0;

    panel.innerHTML = `
      <div class="panel">
        <div class="section-head">
          <h3 class="section-title">Input — Final Base Tables Columns</h3>
        </div>

        ${hasLineage && !isDone ? `
          <div class="chain-banner">
            <div class="chain-icon">⚡</div>
            <div class="chain-text">
              <strong>Auto-loaded from Extract Metadata</strong> — ${lineageRows.length} rows from <code>Final_Base_Tables_Columns</code> ready.
              <br><small>Click Run Mapping to generate both table and column mappings.</small>
            </div>
          </div>
        ` : ''}

        <div class="drop-zone" id="dz-mapping" ${hasLineage ? 'style="opacity:0.5;"' : ''}>
          <div class="drop-icon">↑</div>
          <div class="drop-title">${hasLineage ? 'Or drop a different Final_Base_Tables_Columns.xlsx' : 'Drop Final_Base_Tables_Columns.xlsx'}</div>
          <div class="drop-sub">Must contain DB_Name, Schema_Name, Table_Name, Column_Name columns</div>
          <input id="inp-mapping" type="file" accept=".xlsx,.xls" />
        </div>
        <div id="chip-mapping"></div>

        <div class="buttons-row">
          <button class="btn primary" id="btn-run-mapping" ${hasLineage || isDone ? '' : 'disabled'}>▶ Run Mapping</button>
          ${isDone ? `
            <button class="btn primary" id="btn-dl-table">↓ Download Table Mapping</button>
            <button class="btn primary" id="btn-dl-col">↓ Download Column Mapping</button>
            <button class="btn outline" id="btn-reset-mapping">Reset</button>
          ` : ''}
        </div>
        <div id="mapping-status"></div>
      </div>

      ${isDone ? `
        <div class="panel">
          <div class="section-head">
            <h3 class="section-title">Results</h3>
            <div class="graph-view-toggle">
              <button data-tab="table" class="${activeTab === 'table' ? 'active' : ''}">
                Table Mapping ${tableRows.length ? `<span class="pill info" style="margin-left:6px;">${tableRows.length}</span>` : ''}
              </button>
              <button data-tab="column" class="${activeTab === 'column' ? 'active' : ''}">
                Column Mapping ${columnRows.length ? `<span class="pill info" style="margin-left:6px;">${columnRows.length}</span>` : ''}
              </button>
            </div>
          </div>
          <div id="map-preview"></div>
        </div>
      ` : ''}
    `;

    if (isDone) {
      paintPreview();

      panel.querySelectorAll('.graph-view-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          ws().saved._mappingTab = activeTab;
          persist();
          paintPreview();
          panel.querySelectorAll('.graph-view-toggle button').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === activeTab)
          );
        });
      });

      document.getElementById('btn-dl-table').addEventListener('click', () => saveWorkbook(tableRows, 'Table_Mapping.xlsx'));
      document.getElementById('btn-dl-col').addEventListener('click', () => saveWorkbook(columnRows, 'Column_Mapping.xlsx'));
      document.getElementById('btn-reset-mapping').addEventListener('click', () => {
        delete ws().saved.mapping;
        delete ws().saved._mappingTab;
        persist(); render(); renderNav();
      });
    }

    let overrideFile = null;
    attachDropZone('dz-mapping', 'inp-mapping', (file) => {
      overrideFile = file;
      document.getElementById('chip-mapping').innerHTML = fileChip(file.name);
      document.getElementById('btn-run-mapping').disabled = false;
    });

    document.getElementById('btn-run-mapping').addEventListener('click', async () => {
      const statusEl = document.getElementById('mapping-status');
      statusEl.innerHTML = '<div class="note">⏳ Running table + column mapping... this may take a moment.</div>';
      document.getElementById('btn-run-mapping').disabled = true;
      try {
        const file = overrideFile || rowsToXlsx(lineageRows, 'Final_Base_Tables_Columns');
        const fd = new FormData();
        fd.append('lineage_file', file);
        const data = await apiPost('/stage2/map-all', fd);
        ws().saved.mapping = { table: data.table.rows, column: data.column.rows };
        persist(); render(); renderNav();
        logActivity('Mapping: ' + data.table.mapped + ' tables mapped, ' + data.column.matched + ' columns matched');
        toast('Tables: ' + data.table.mapped + '/' + data.table.total + ' mapped · Columns: ' + data.column.matched + ' matched', 'success');
      } catch (err) {
        toast('API error: ' + err.message, 'error');
        statusEl.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
        document.getElementById('btn-run-mapping').disabled = false;
      }
    });
  }

  render();
}
