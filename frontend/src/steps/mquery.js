function renderMQuery(panel) {
  panel.innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">Inputs — SQL body + Mapping + Prompt</h3>
      </div>
      <div class="io-grid">
        <div>
          <label class="field">SQL file(s)</label>
          <div class="drop-zone" id="dz-mq-sql">
            <div class="drop-icon">↑</div>
            <div class="drop-title">Drop .sql or .txt</div>
            <div class="drop-sub">Raw SQL used as the [Query=...] body.</div>
            <input id="mq-sql-input" type="file" accept=".sql,.txt" multiple />
          </div>
          <div id="mq-sql-chip"></div>
        </div>
        <div>
          <label class="field">Mapping file (.xlsx)</label>
          <div class="drop-zone" id="dz-mq-map">
            <div class="drop-icon">↑</div>
            <div class="drop-title">Drop mapping .xlsx</div>
            <div class="drop-sub">Table and/or column mapping to remap the SQL.</div>
            <input id="mq-map-input" type="file" accept=".xlsx" />
          </div>
          <div id="mq-map-chip"></div>
        </div>
        <div>
          <label class="field">Prompt file (.xlsx) <span style="opacity:0.6;font-size:11px;">(optional)</span></label>
          <div class="drop-zone" id="dz-mq-prompt">
            <div class="drop-icon">↑</div>
            <div class="drop-title">Drop prompt .xlsx</div>
            <div class="drop-sub">Date clause / filter configuration.</div>
            <input id="mq-prompt-input" type="file" accept=".xlsx" />
          </div>
          <div id="mq-prompt-chip"></div>
        </div>
      </div>
      <div class="buttons-row" style="margin-top:16px;">
        <button class="btn primary" id="mq-convert">Generate M-Query</button>
        <button class="btn secondary" id="mq-download" ${ws().saved.mquery ? '' : 'disabled'}>↓ Download ZIP</button>
        <button class="btn outline" id="mq-clear">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Conversion results</h3></div>
      <div id="mq-result"></div>
    </div>
  `;
  bindStepper();

  let sqlFiles = [];
  let mappingFile = null;
  let promptFile = null;
  const result = document.getElementById('mq-result');
  const dlBtn = document.getElementById('mq-download');

  function paint() {
    if (!ws().saved.mquery) { result.innerHTML = '<div class="note">Upload files and click Convert.</div>'; return; }
    const results = ws().saved.mquery.results;
    result.innerHTML = `
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

  attachDropZone('dz-mq-prompt', 'mq-prompt-input', (file) => {
    promptFile = file;
    document.getElementById('mq-prompt-chip').innerHTML = fileChip(file.name);
  });

  function buildFormData() {
    const fd = new FormData();
    sqlFiles.forEach(f => fd.append('sql_files', f));
    fd.append('mapping_file', mappingFile);
    if (promptFile) fd.append('prompt_file', promptFile);
    return fd;
  }

  document.getElementById('mq-convert').addEventListener('click', async () => {
    if (!sqlFiles.length) { toast('Upload at least one .sql file', 'warn'); return; }
    if (!mappingFile) { toast('Upload the mapping .xlsx file', 'warn'); return; }
    result.innerHTML = '<div class="note">⏳ Converting...</div>';
    try {
      const data = await apiPost('/stage3/convert', buildFormData());
      ws().saved.mquery = data;
      persist(); paint(); dlBtn.disabled = false; renderNav();
      logActivity('M-Query: converted ' + data.total_files + ' file(s)');
      toast('Converted ' + data.total_files + ' file(s)', 'success');
    } catch (err) {
      toast('API error: ' + err.message, 'error');
      result.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
    }
  });

  dlBtn.addEventListener('click', async () => {
    if (!sqlFiles.length || !mappingFile) { toast('Re-upload files to download ZIP', 'warn'); return; }
    try {
      await apiDownload('/stage3/convert/download', buildFormData(), 'mquery_outputs.zip');
    } catch (err) {
      toast('Download error: ' + err.message, 'error');
    }
  });

  document.getElementById('mq-clear').addEventListener('click', () => {
    sqlFiles = []; mappingFile = null; promptFile = null;
    delete ws().saved.mquery;
    persist(); renderPage(); renderNav();
  });
}
