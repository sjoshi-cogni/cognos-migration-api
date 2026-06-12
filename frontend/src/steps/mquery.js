function renderMQuery(panel) {
  panel.innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">Upload SQL files + Mapping file</h3>
      </div>
      <div class="io-grid">
        <div>
          <label class="field">SQL file(s)</label>
          <div class="drop-zone" id="dz-mq-sql">
            <div class="drop-icon">↑</div>
            <div class="drop-title">Drop one or more .sql files</div>
            <input id="mq-sql-input" type="file" accept=".sql" multiple />
          </div>
          <div id="mq-sql-chip"></div>
        </div>
        <div>
          <label class="field">Mapping file (.xlsx)</label>
          <div class="drop-zone" id="dz-mq-map">
            <div class="drop-icon">↑</div>
            <div class="drop-title">Drop column mapping .xlsx</div>
            <input id="mq-map-input" type="file" accept=".xlsx" />
          </div>
          <div id="mq-map-chip"></div>
        </div>
      </div>
      <div class="buttons-row" style="margin-top:16px;">
        <button class="btn primary" id="mq-convert">Convert to M-Query</button>
        <button class="btn secondary" id="mq-download" ${ws().saved.mquery ? '' : 'disabled'}>↓ Download ZIP</button>
        <button class="btn outline" id="mq-clear">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Conversion results</h3></div>
      <div id="mq-preview"></div>
    </div>
  `;
  bindStepper();

  let sqlFiles = [];
  let mappingFile = null;
  const preview = document.getElementById('mq-preview');
  const dlBtn = document.getElementById('mq-download');

  function paint() {
    if (!ws().saved.mquery) { preview.innerHTML = '<div class="note">Upload files and click Convert.</div>'; return; }
    const results = ws().saved.mquery.results;
    preview.innerHTML = `
      <div class="note success">✓ Converted ${ws().saved.mquery.total_files} file(s).</div>
      <div class="table-wrapper"><table class="table">
        <thead><tr><th>File</th><th>Output</th><th>Status</th><th>List prompts</th><th>Date prompts</th></tr></thead>
        <tbody>${results.map(r => `
          <tr>
            <td>${escapeHtml(r.filename)}</td>
            <td>${escapeHtml(r.output_filename)}</td>
            <td><span class="pill ${r.status === 'success' ? 'passed' : 'failed'}">${escapeHtml(r.status)}</span></td>
            <td>${r.list_prompts_found}</td>
            <td>${r.date_prompts_found}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  }
  paint();

  attachDropZone('dz-mq-sql', 'mq-sql-input', (files) => {
    sqlFiles = Array.isArray(files) ? files : [files];
    document.getElementById('mq-sql-chip').innerHTML = sqlFiles.map(f => fileChip(f.name)).join('');
  }, true);

  attachDropZone('dz-mq-map', 'mq-map-input', (file) => {
    mappingFile = file;
    document.getElementById('mq-map-chip').innerHTML = fileChip(file.name);
  });

  document.getElementById('mq-convert').addEventListener('click', async () => {
    if (!sqlFiles.length) { toast('Upload at least one .sql file', 'warn'); return; }
    if (!mappingFile) { toast('Upload the mapping .xlsx file', 'warn'); return; }
    preview.innerHTML = '<div class="note">⏳ Converting...</div>';
    try {
      const fd = new FormData();
      sqlFiles.forEach(f => fd.append('sql_files', f));
      fd.append('mapping_file', mappingFile);
      const data = await apiPost('/stage3/convert', fd);
      ws().saved.mquery = data;
      persist(); paint(); dlBtn.disabled = false; renderNav();
      logActivity('M-Query: converted ' + data.total_files + ' file(s)');
      toast('Converted ' + data.total_files + ' file(s)', 'success');
    } catch (err) {
      toast('API error: ' + err.message, 'error');
      preview.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
    }
  });

  dlBtn.addEventListener('click', async () => {
    if (!sqlFiles.length || !mappingFile) { toast('Re-upload files to download ZIP', 'warn'); return; }
    try {
      const fd = new FormData();
      sqlFiles.forEach(f => fd.append('sql_files', f));
      fd.append('mapping_file', mappingFile);
      await apiDownload('/stage3/convert/download', fd, 'mquery_outputs.zip');
    } catch (err) {
      toast('Download error: ' + err.message, 'error');
    }
  });

  document.getElementById('mq-clear').addEventListener('click', () => {
    sqlFiles = []; mappingFile = null;
    delete ws().saved.mquery;
    persist(); renderPage(); renderNav();
  });
}