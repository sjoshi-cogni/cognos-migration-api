function renderMapping(panel) {
  bindStepper();

  function render() {
    const tableRows  = ws().saved.mapping?.table  || [];
    const columnRows = ws().saved.mapping?.column || [];
    const step1Done  = tableRows.length > 0;
    const step2Done  = columnRows.length > 0;

    panel.innerHTML = `
      <div class="wizard">

        <!-- STEP 1: Table Mapping -->
        <div class="wizard-step ${step1Done ? 'wz-done' : 'wz-active'}">
          <div class="wz-header">
            <div class="wz-num">${step1Done ? '✓' : '1'}</div>
            <div class="wz-info">
              <span class="wz-title">Table Mapping</span>
              <span class="wz-sub">Upload base tables file — maps Cognos tables → EDH 2.0 via Databricks</span>
            </div>
            <span class="pill ${step1Done ? 'passed' : 'warn'}">${step1Done ? 'done · ' + tableRows.length + ' rows' : 'pending'}</span>
          </div>
          <div class="wz-body">
            ${step1Done ? `
              <div class="note success">✓ ${tableRows.length} table mappings ready.</div>
              <div class="buttons-row">
                <button class="btn primary sm" id="wz-dl-table">↓ Download Table Mapping</button>
                <button class="btn outline sm" id="wz-clear-table">Reset</button>
              </div>
              <div id="wz-preview-table" style="margin-top:14px;"></div>
            ` : `
              <div class="drop-zone" id="dz-table">
                <div class="drop-icon">↑</div>
                <div class="drop-title">Drop base tables .xlsx</div>
                <div class="drop-sub">Must contain DB_Name, Schema_Name, Table_Name columns</div>
                <input id="inp-table" type="file" accept=".xlsx,.xls" />
              </div>
              <div id="chip-table"></div>
              <div id="wz-preview-table" style="margin-top:14px;"></div>
            `}
          </div>
        </div>

        <div class="wz-connector ${step1Done ? 'wz-connector-active' : ''}"></div>

        <!-- STEP 2: Column Mapping -->
        <div class="wizard-step ${!step1Done ? 'wz-locked' : step2Done ? 'wz-done' : 'wz-active'}">
          <div class="wz-header">
            <div class="wz-num">${step2Done ? '✓' : '2'}</div>
            <div class="wz-info">
              <span class="wz-title">Column Mapping</span>
              <span class="wz-sub">Upload base table columns file — AI-based matching with confidence scores</span>
            </div>
            <span class="pill ${step2Done ? 'passed' : !step1Done ? 'info' : 'warn'}">${step2Done ? 'done · ' + columnRows.length + ' rows' : !step1Done ? 'locked' : 'pending'}</span>
          </div>
          <div class="wz-body">
            ${!step1Done ? `
              <div class="note">Complete Step 1 first.</div>
            ` : step2Done ? `
              <div class="note success">✓ ${columnRows.length} column mappings ready.</div>
              <div class="buttons-row">
                <button class="btn primary sm" id="wz-dl-col">↓ Download Column Mapping</button>
                <button class="btn outline sm" id="wz-clear-col">Reset</button>
              </div>
              <div id="wz-preview-col" style="margin-top:14px;"></div>
            ` : `
              <div class="note" style="margin-bottom:12px;">
                Table mapping from Step 1 will be used automatically as <code>mapping_file</code>.
              </div>
              <div class="drop-zone" id="dz-column">
                <div class="drop-icon">↑</div>
                <div class="drop-title">Drop base table columns .xlsx</div>
                <div class="drop-sub">Must contain DB_Name, Schema_Name, Table_Name, Column_Name columns</div>
                <input id="inp-column" type="file" accept=".xlsx,.xls" />
              </div>
              <div id="chip-column"></div>
              <div id="wz-preview-col" style="margin-top:14px;"></div>
            `}
          </div>
        </div>

      </div>
    `;

    // — Step 1 handlers —
    if (step1Done) {
      renderSearchableTable(document.getElementById('wz-preview-table'), tableRows, null);
      document.getElementById('wz-dl-table').addEventListener('click', () => saveWorkbook(tableRows, 'table_mapping.xlsx'));
      document.getElementById('wz-clear-table').addEventListener('click', () => {
        delete ws().saved.mapping;
        persist(); render(); renderNav();
      });
    } else {
      attachDropZone('dz-table', 'inp-table', async (file) => {
        document.getElementById('chip-table').innerHTML = fileChip(file.name);
        document.getElementById('wz-preview-table').innerHTML = '<div class="note">⏳ Running table mapping...</div>';
        try {
          const fd = new FormData();
          fd.append('lineage_file', file);
          const data = await apiPost('/stage2/map-tables', fd);
          ws().saved.mapping = ws().saved.mapping || {};
          ws().saved.mapping.table = data.rows;
          persist(); render(); renderNav();
          logActivity('Table mapping: ' + data.mapped + ' mapped, ' + data.not_found + ' not found');
          toast('Mapped ' + data.mapped + ' of ' + data.total + ' tables', 'success');
        } catch (err) {
          toast('API error: ' + err.message, 'error');
          document.getElementById('wz-preview-table').innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
        }
      });
    }

    // — Step 2 handlers —
    if (step1Done) {
      if (step2Done) {
        renderSearchableTable(document.getElementById('wz-preview-col'), columnRows, null);
        document.getElementById('wz-dl-col').addEventListener('click', () => saveWorkbook(columnRows, 'column_mapping.xlsx'));
        document.getElementById('wz-clear-col').addEventListener('click', () => {
          delete ws().saved.mapping.column;
          persist(); render(); renderNav();
        });
      } else {
        attachDropZone('dz-column', 'inp-column', async (file) => {
          document.getElementById('chip-column').innerHTML = fileChip(file.name);
          document.getElementById('wz-preview-col').innerHTML = '<div class="note">⏳ Running column mapping...</div>';
          try {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tableRows), 'Sheet1');
            const mappingFile = new File(
              [XLSX.write(wb, { bookType: 'xlsx', type: 'array' })],
              'table_mapping.xlsx',
              { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
            );
            const fd = new FormData();
            fd.append('lineage_file', file);
            fd.append('mapping_file', mappingFile);
            const data = await apiPost('/stage2/map-columns', fd);
            ws().saved.mapping.column = data.rows;
            persist(); render(); renderNav();
            logActivity('Column mapping: ' + data.matched + ' matched, ' + data.low_confidence + ' low conf, ' + data.unmapped + ' unmapped');
            toast('Matched: ' + data.matched + ' | Low conf: ' + data.low_confidence + ' | Unmapped: ' + data.unmapped, 'success');
          } catch (err) {
            toast('API error: ' + err.message, 'error');
            document.getElementById('wz-preview-col').innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
          }
        });
      }
    }
  }

  render();
}
