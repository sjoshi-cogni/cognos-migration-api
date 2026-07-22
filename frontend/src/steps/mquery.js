function renderMQuery(panel) {
  let previewIdx = 0;

  function paint() {
    const hasMquery = !!ws().saved.mquery;
    const generated = ws().saved._mqGenerated || [];
    const results   = ws().saved.mquery?.results || [];

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
              <div class="drop-sub">PromptDefinitions sheet drives filter generation.</div>
              <input id="mq-prompt-input" type="file" accept=".xlsx" />
            </div>
            <div id="mq-prompt-chip"></div>
          </div>
        </div>
        <div class="buttons-row" style="margin-top:16px;">
          <button class="btn primary" id="mq-convert">▶ Generate M-Query</button>
          <button class="btn outline" id="mq-clear">Reset</button>
        </div>
        <div id="mq-status"></div>
      </div>

      ${hasMquery ? `
        <div class="panel">
          <div class="section-head">
            <h3 class="section-title">Results
              <span class="pill info" style="margin-left:8px;">${results.length} file(s)</span>
            </h3>
          </div>

          <div class="table-wrapper" style="margin-bottom:16px;">
            <table class="table">
              <thead><tr><th>File</th><th>Output</th><th>Status</th><th>List prompts</th><th>Date prompts</th></tr></thead>
              <tbody>${results.map((r, i) => `
                <tr class="mq-row${i === previewIdx ? ' diff-mod' : ''}" data-index="${i}" style="cursor:pointer;" title="Click to preview">
                  <td>${escapeHtml(r.filename)}</td>
                  <td>${escapeHtml(r.output_filename)}</td>
                  <td><span class="pill ${r.status === 'success' ? 'passed' : 'failed'}">${escapeHtml(r.status)}</span></td>
                  <td>${r.list_prompts_found}</td>
                  <td>${r.date_prompts_found}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div class="section-head" style="margin-bottom:8px;">
            <h3 class="section-title">M-Query Preview</h3>
            <span style="font-size:11px;color:var(--text-mute);">Click a row above to switch files</span>
          </div>
          <pre id="mq-preview" style="
            background: var(--bg-0);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px;
            overflow: auto;
            max-height: 520px;
            white-space: pre;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: var(--accent);
            line-height: 1.6;
            margin: 0;
          ">${escapeHtml(generated[previewIdx]?.content || '')}</pre>
        </div>
      ` : ''}
    `;

    bindStepper();
    bindActions(generated);
  }

  function showPreview(idx, generated) {
    previewIdx = idx;
    const pre = document.getElementById('mq-preview');
    if (pre) pre.textContent = generated[idx]?.content || '';
    // highlight active row
    document.querySelectorAll('.mq-row').forEach((row, i) => {
      row.classList.toggle('diff-mod', i === idx);
    });
  }

  let sqlFiles    = [];
  let mappingFile = null;
  let promptFile  = null;

  function bindActions(generated) {
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

    // Click row to preview
    document.querySelectorAll('.mq-row').forEach(row => {
      row.addEventListener('click', () => showPreview(+row.dataset.index, generated));
    });

    // Generate
    document.getElementById('mq-convert').addEventListener('click', async () => {
      if (!sqlFiles.length) { toast('Upload at least one .sql file', 'warn'); return; }
      if (!mappingFile)     { toast('Upload the mapping .xlsx file', 'warn'); return; }
      document.getElementById('mq-status').innerHTML = '<div class="note" style="margin-top:12px;">⏳ Converting...</div>';
      document.getElementById('mq-convert').disabled = true;
      try {
        const fd = new FormData();
        sqlFiles.forEach(f => fd.append('sql_files', f));
        fd.append('mapping_file', mappingFile);
        if (promptFile) fd.append('prompt_file', promptFile);

        const zipBlob    = await apiDownloadBlob('/stage3/convert/download', fd);
        const zip        = await JSZip.loadAsync(zipBlob);
        const newGenerated = [];
        for (const [filename, zipEntry] of Object.entries(zip.files)) {
          newGenerated.push({ name: filename, content: await zipEntry.async('string') });
        }

        ws().saved.mquery = {
          total_files: newGenerated.length,
          results: newGenerated.map(f => ({
            filename:           f.name.replace('_Mquery_FINAL.txt', '.sql'),
            status:             'success',
            output_filename:    f.name,
            list_prompts_found: 0,
            date_prompts_found: 0,
          })),
        };
        ws().saved._mqGenerated = newGenerated;
        previewIdx = 0;
        persist(); paint(); renderNav();
        logActivity('M-Query: converted ' + newGenerated.length + ' file(s)');
        toast('Converted ' + newGenerated.length + ' file(s)', 'success');
      } catch (err) {
        toast('API error: ' + err.message, 'error');
        document.getElementById('mq-status').innerHTML = '<div class="note error" style="margin-top:12px;">Error: ' + escapeHtml(err.message) + '</div>';
        document.getElementById('mq-convert').disabled = false;
      }
    });

    // Reset
    document.getElementById('mq-clear').addEventListener('click', () => {
      sqlFiles = []; mappingFile = null; promptFile = null;
      delete ws().saved.mquery;
      delete ws().saved._mqGenerated;
      delete ws().saved.aivalidation;
      previewIdx = 0;
      persist(); renderPage(); renderNav();
    });
  }

  paint();
}
