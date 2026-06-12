function renderMapping(panel) {
  panel.innerHTML = `
    <div class="tab-row" role="tablist">
      <button class="tab active" data-tab="table">Table-Level Mapping</button>
      <button class="tab" data-tab="column">Column-Level Mapping</button>
    </div>
    <div id="mapping-body"></div>
  `;
  bindStepper();
  let activeTab = 'table';

  function render() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
    const body = document.getElementById('mapping-body');
    const isTable    = activeTab === 'table';
    const leftLabel  = isTable ? 'Legacy Table'  : 'Legacy Column';
    const rightLabel = isTable ? 'EDH 2.0 Table' : 'Target Column';
    const exampleL   = isTable ? 'customer'      : 'custid';
    const exampleR   = isTable ? 'customermaster' : 'customer_id';
    const history = ws().mappingHistory[activeTab] || [];
    const currentMapping = ws().saved.mapping && ws().saved.mapping[activeTab];

    body.innerHTML = `
      <div class="panel">
        <div class="section-head">
          <h3 class="section-title">${isTable ? 'Map legacy tables → EDH 2.0' : 'Map legacy columns → EDH 2.0'}</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="pill warn">Example: ${exampleL} → ${exampleR}</span>
            ${history.length >= 2 ? `<button class="btn outline sm" id="show-diff">Show version diff (${history.length})</button>` : ''}
          </div>
        </div>
        <div class="drop-zone" id="dz-map-${activeTab}">
          <div class="drop-icon">↑</div>
          <div class="drop-title">Drop .xlsx file</div>
          <div class="drop-sub">Auto-detects "${leftLabel}" and "${rightLabel}" columns.</div>
          <input id="map-input-${activeTab}" type="file" accept=".xlsx,.xls" />
        </div>
        <div id="map-chip-${activeTab}"></div>
        <div class="buttons-row">
          <button class="btn primary" id="dl-map-${activeTab}" ${currentMapping ? '' : 'disabled'}>↓ Download .xlsx</button>
          <button class="btn outline" id="clear-map-${activeTab}">Reset</button>
        </div>
      </div>
      <div class="panel">
        <div class="section-head"><h3 class="section-title">Mapping result</h3></div>
        <div id="map-preview-${activeTab}"></div>
      </div>
    `;

    const preview = document.getElementById('map-preview-' + activeTab);

    if (currentMapping && currentMapping.length) {
      preview.innerHTML = `<div class="note success">✓ ${currentMapping.length} mapping pair(s).</div><div id="map-tbl"></div>`;
      renderSearchableTable(document.getElementById('map-tbl'), currentMapping, [leftLabel, rightLabel]);
    } else {
      preview.innerHTML = '<div class="note">Upload a file to see the mapping.</div>';
    }

    // --- TABLE TAB ---
    attachDropZone('dz-map-table', 'map-input-table', async (file) => {
      document.getElementById('map-chip-table').innerHTML = fileChip(file.name);
      preview.innerHTML = '<div class="note">⏳ Calling API...</div>';
      try {
        const fd = new FormData();
        fd.append('lineage_file', file);
        const data = await apiPost('/stage2/map-tables', fd);
        ws().saved.mapping = ws().saved.mapping || {};
        ws().saved.mapping.table = data.rows;
        ws().mappingHistory.table = ws().mappingHistory.table || [];
        ws().mappingHistory.table.push({ time: new Date().toISOString(), rows: data.rows });
        ws().mappingHistory.table = ws().mappingHistory.table.slice(-10);
        persist(); render(); renderNav();
        logActivity('Table mapping: ' + data.mapped + ' mapped, ' + data.not_found + ' not found');
        toast('Mapped ' + data.mapped + ' of ' + data.total + ' tables', 'success');
      } catch (err) {
        toast('API error: ' + err.message, 'error');
        preview.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
      }
    });

    // --- COLUMN TAB ---
    // Column mapping needs TWO files: lineage .xlsx + table mapping .xlsx
    // The current UI only has one drop zone for column tab.
    // We need to track both files separately before calling the API.
    attachDropZone('dz-map-column', 'map-input-column', async (file) => {
      document.getElementById('map-chip-column').innerHTML = fileChip(file.name);

      // lineage file = what user drops here
      // mapping file = table mapping output stored from previous tab
      const tableMappingRows = ws().saved.mapping && ws().saved.mapping.table;
      if (!tableMappingRows || !tableMappingRows.length) {
        toast('Run Table Mapping first — its output is needed as mapping_file', 'warn');
        preview.innerHTML = '<div class="note warn">⚠ Complete Table-Level Mapping tab first.</div>';
        return;
      }

      preview.innerHTML = '<div class="note">⏳ Calling API...</div>';
      try {
        // Convert stored table mapping rows back to xlsx blob for the API
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tableMappingRows), 'Sheet1');
        const wbBlob = new Blob(
          [XLSX.write(wb, { bookType: 'xlsx', type: 'array' })],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        );
        const mappingFile = new File([wbBlob], 'table_mapping.xlsx');

        const fd = new FormData();
        fd.append('lineage_file', file);       // lineage .xlsx the user uploads
        fd.append('mapping_file', mappingFile); // table mapping rebuilt from saved state
        const data = await apiPost('/stage2/map-columns', fd);
        ws().saved.mapping = ws().saved.mapping || {};
        ws().saved.mapping.column = data.rows;
        ws().mappingHistory.column = ws().mappingHistory.column || [];
        ws().mappingHistory.column.push({ time: new Date().toISOString(), rows: data.rows });
        ws().mappingHistory.column = ws().mappingHistory.column.slice(-10);
        persist(); render(); renderNav();
        logActivity('Column mapping: ' + data.matched + ' matched, ' + data.low_confidence + ' low conf, ' + data.unmapped + ' unmapped');
        toast('Matched: ' + data.matched + ' | Low conf: ' + data.low_confidence + ' | Unmapped: ' + data.unmapped, 'success');
      } catch (err) {
        toast('API error: ' + err.message, 'error');
        preview.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
      }
    });

    document.getElementById('dl-map-' + activeTab).addEventListener('click', () => {
      const d = ws().saved.mapping && ws().saved.mapping[activeTab];
      if (d) saveWorkbook(d, (isTable ? 'table' : 'column') + '_mapping.xlsx');
    });

    document.getElementById('clear-map-' + activeTab).addEventListener('click', () => {
      if (ws().saved.mapping) delete ws().saved.mapping[activeTab];
      persist(); render(); renderNav();
    });

    const diffBtn = document.getElementById('show-diff');
    if (diffBtn) diffBtn.addEventListener('click', () => showMappingDiff(activeTab, leftLabel, rightLabel));
  }

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(); }));
  render();
}

function showMappingDiff(tab, leftLabel, rightLabel) {
  const history = ws().mappingHistory[tab];
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const prevMap = new Map(prev.rows.map(r => [r[leftLabel], r[rightLabel]]));
  const currMap = new Map(curr.rows.map(r => [r[leftLabel], r[rightLabel]]));
  const allKeys = Array.from(new Set([...prevMap.keys(), ...currMap.keys()]));

  const rows = allKeys.map(k => {
    const p = prevMap.get(k), c = currMap.get(k);
    const status = p === undefined ? 'added' : c === undefined ? 'removed' : p !== c ? 'modified' : 'unchanged';
    return { [leftLabel]: k, Previous: p == null ? '' : p, Current: c == null ? '' : c, Status: status };
  });

  const added    = rows.filter(r => r.Status === 'added').length;
  const removed  = rows.filter(r => r.Status === 'removed').length;
  const modified = rows.filter(r => r.Status === 'modified').length;

  openModal(`
    <h3>Mapping version diff</h3>
    <p>Comparing v${history.length - 1} → v${history.length} (${fmtTime(prev.time)} vs ${fmtTime(curr.time)})</p>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <span class="pill passed">+${added} added</span>
      <span class="pill failed">-${removed} removed</span>
      <span class="pill warn">~${modified} modified</span>
    </div>
    <div class="table-wrapper" style="max-height:50vh;">
      <table class="table">
        <thead><tr><th>${leftLabel}</th><th>Previous</th><th>Current</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${r.Status === 'added' ? 'diff-add' : r.Status === 'removed' ? 'diff-del' : r.Status === 'modified' ? 'diff-mod' : ''}">
              <td>${escapeHtml(r[leftLabel])}</td>
              <td>${escapeHtml(r.Previous)}</td>
              <td>${escapeHtml(r.Current)}</td>
              <td><span class="pill ${r.Status === 'added' ? 'passed' : r.Status === 'removed' ? 'failed' : r.Status === 'modified' ? 'warn' : 'info'}">${r.Status}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn outline" id="diff-close">Close</button>
      <button class="btn primary" id="diff-export">Export diff .xlsx</button>
    </div>
  `);
  document.getElementById('diff-close').addEventListener('click', closeModal);
  document.getElementById('diff-export').addEventListener('click', () => { saveWorkbook(rows, tab + '_mapping_diff.xlsx'); closeModal(); });
}
