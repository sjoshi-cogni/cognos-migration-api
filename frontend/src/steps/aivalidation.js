function renderAIValidation(panel) {
  const generated = ws().saved._mqGenerated;
  const hasMquery = !!(ws().saved.mquery && generated && generated.length);

  panel.innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">M-Query AI Validation</h3>
      </div>
      <div style="margin-bottom:12px;">
        ${hasMquery
          ? `<div class="note success">
               ✓ ${generated.length} M-Query file(s) ready for AI validation:<br>
               <span style="font-size:12px;opacity:0.8;">${generated.map(f => escapeHtml(f.name)).join(', ')}</span>
             </div>`
          : `<div class="note warn">⏳ Waiting for M-Query generation... Complete Step 3 first.</div>`
        }
      </div>
      <div class="buttons-row" style="margin-top:16px;">
        <button class="btn primary" id="ai-fix-btn" style="background:#7b2ff7;" ${hasMquery ? '' : 'disabled'}>✨ Run AI Validation</button>
        <button class="btn secondary" id="ai-dl-all-btn" ${ws().saved.aivalidation ? '' : 'disabled'}>↓ Download All as ZIP</button>
        <button class="btn outline" id="ai-clear-btn">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">AI Validation results</h3></div>
      <div id="ai-result"></div>
    </div>
  `;
  bindStepper();

  const result = document.getElementById('ai-result');
  const dlAllBtn = document.getElementById('ai-dl-all-btn');

  function paint() {
    if (!ws().saved.aivalidation) {
      result.innerHTML = hasMquery
        ? '<div class="note">Click ✨ Run AI Validation to start.</div>'
        : '<div class="note">Complete M-Query Generation step first.</div>';
      return;
    }
    const results = ws().saved.aivalidation.results;
    const fixedCount = results.filter(r => r.llm_success).length;
    result.innerHTML = `
      <div class="note success">✨ AI processed ${ws().saved.aivalidation.total_files} file(s) — ${fixedCount} fixed, ${results.length - fixedCount} failed.</div>
      <div class="table-wrapper"><table class="table">
        <thead><tr><th>File</th><th>Output</th><th>AI Status</th><th>Summary</th></tr></thead>
        <tbody>${results.map(r => `
          <tr>
            <td>${escapeHtml(r.filename)}</td>
            <td>${escapeHtml(r.output_filename)}</td>
            <td><span class="pill ${r.llm_success ? 'passed' : 'failed'}">${r.llm_success ? '✨ Fixed' : '⚠ Failed'}</span></td>
            <td style="font-size:11px;max-width:260px;word-break:break-word;">${escapeHtml(r.llm_summary || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:12px;">
        ${results.map((r, i) => `
          <details style="margin-bottom:8px;">
            <summary style="cursor:pointer;font-weight:600;">${escapeHtml(r.filename)} — M-Query</summary>
            <pre style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;overflow:auto;max-height:300px;white-space:pre-wrap;font-size:11px;margin-top:6px;">${escapeHtml(r.fixed_mquery || '')}</pre>
            <button class="btn secondary ai-single-dl" data-index="${i}" style="margin-top:6px;">↓ Download this file</button>
          </details>`).join('')}
      </div>`;

    result.querySelectorAll('.ai-single-dl').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = results[+btn.dataset.index];
        downloadText(r.fixed_mquery || '', r.output_filename);
      });
    });
  }
  paint();

  document.getElementById('ai-fix-btn').addEventListener('click', async () => {
    result.innerHTML = '<div class="note">✨ AI is fixing and validating SQL — this may take a few minutes...</div>';
    try {
      const fd = new FormData();
      generated.forEach(f => fd.append('mquery_files', new Blob([f.content], { type: 'text/plain' }), f.name));
      const data = await apiPost('/stage3/validate-mquery', fd);
      ws().saved.aivalidation = data;
      persist(); paint(); dlAllBtn.disabled = false; renderNav();
      logActivity('AI Validation: ' + data.results.filter(r => r.llm_success).length + '/' + data.total_files + ' fixed');
      toast('AI Validation complete — ' + data.total_files + ' file(s)', 'success');
    } catch (err) {
      toast('API error: ' + err.message, 'error');
      result.innerHTML = '<div class="note error">Error: ' + escapeHtml(err.message) + '</div>';
    }
  });

  dlAllBtn.addEventListener('click', async () => {
    if (!ws().saved.aivalidation) return;
    if (!window.JSZip) { toast('JSZip not loaded', 'error'); return; }
    const zip = new JSZip();
    ws().saved.aivalidation.results.forEach(r => {
      if (r.fixed_mquery) zip.file(r.output_filename, r.fixed_mquery);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'ai_validated_mqueries.zip');
  });

  document.getElementById('ai-clear-btn').addEventListener('click', () => {
    delete ws().saved.aivalidation;
    persist(); renderPage(); renderNav();
  });
}
