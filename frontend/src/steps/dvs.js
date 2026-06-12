function renderDVS(panel) {
  panel.innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3 class="section-title">Upload source & target</h3>
        <button class="btn outline sm" id="open-rules">Custom validation rules</button>
      </div>
      <div class="io-grid">
        <div>
          <label class="field">Source (legacy)</label>
          <div class="drop-zone" id="dz-src" style="padding:24px;">
            <div class="drop-title">Drop source file</div>
            <div class="drop-sub">.xlsx or .pbix</div>
            <input id="src-input" type="file" accept=".xlsx,.xls,.pbix" />
          </div>
          <div id="src-chip"></div>
        </div>
        <div>
          <label class="field">Target (EDH 2.0)</label>
          <div class="drop-zone" id="dz-tgt" style="padding:24px;">
            <div class="drop-title">Drop target file</div>
            <div class="drop-sub">.xlsx or .pbix</div>
            <input id="tgt-input" type="file" accept=".xlsx,.xls,.pbix" />
          </div>
          <div id="tgt-chip"></div>
        </div>
      </div>
      <div class="flex-row" style="margin-top:18px;">
        <label class="field">Output format
          <select id="dvs-format" class="input">
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="html">HTML report (.html)</option>
            <option value="txt">Plain text (.txt)</option>
          </select>
        </label>
        <button class="btn primary"   id="dl-dvs"       ${ws().saved.dvs ? '' : 'disabled'}>↓ Download validation</button>
        <button class="btn secondary" id="show-row-diff" ${ws().saved.dvs ? '' : 'disabled'}>Show row-level diff</button>
        <button class="btn outline"   id="clear-dvs">Reset</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h3 class="section-title">Validation summary</h3></div>
      <div id="dvs-preview"></div>
    </div>
  `;
  bindStepper();

  let srcRows = (ws().saved.dvs && ws().saved.dvs.srcRows) || [];
  let tgtRows = (ws().saved.dvs && ws().saved.dvs.tgtRows) || [];
  const preview = document.getElementById('dvs-preview');
  const dlBtn   = document.getElementById('dl-dvs');
  const diffBtn = document.getElementById('show-row-diff');

  function paintSummary(summary) {
    preview.innerHTML = `
      <div class="note success">✓ Comparison complete.</div>
      <div class="table-wrapper"><table class="table">
        <thead><tr><th>Metric</th><th>Source</th><th>Target</th><th>Status</th></tr></thead>
        <tbody>${summary.map(r => `
          <tr>
            <td><strong>${escapeHtml(r.Metric)}</strong></td>
            <td class="wide">${escapeHtml(r.Source)}</td>
            <td class="wide">${escapeHtml(r.Target)}</td>
            <td><span class="pill ${r.Status}">${r.Status}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  function runValidation() {
    const hasSrc = srcRows.length > 0, hasTgt = tgtRows.length > 0;
    if (!hasSrc && !hasTgt) { preview.innerHTML = '<div class="note">Upload both source and target files to compare.</div>'; return; }
    if (!hasSrc || !hasTgt) {
      const have = hasSrc ? 'source (' + srcRows.length + ' rows)' : 'target (' + tgtRows.length + ' rows)';
      const missing = !hasSrc ? 'source' : 'target';
      preview.innerHTML = '<div class="note warn">⚠ Got ' + have + '. Still waiting for the ' + missing + ' file.</div>';
      dlBtn.disabled = diffBtn.disabled = true;
      return;
    }
    const summary = applyRules(srcRows, tgtRows, ws().customRules);
    ws().saved.dvs = { summary, srcRows, tgtRows };
    persist(); paintSummary(summary); dlBtn.disabled = diffBtn.disabled = false; renderNav();
    logActivity('DVS: ' + summary.filter(s => s.Status === 'passed').length + '/' + summary.length + ' rules passed');
    toast('Validation complete (' + summary.length + ' rules)', 'success');
  }

  if (ws().saved.dvs) paintSummary(ws().saved.dvs.summary);

  attachDropZone('dz-src', 'src-input', (file) => {
    document.getElementById('src-chip').innerHTML = fileChip(file.name);
    parseFileToRows(file).then(rows => { srcRows = rows; runValidation(); });
  });
  attachDropZone('dz-tgt', 'tgt-input', (file) => {
    document.getElementById('tgt-chip').innerHTML = fileChip(file.name);
    parseFileToRows(file).then(rows => { tgtRows = rows; runValidation(); });
  });

  dlBtn.addEventListener('click', () => exportDvs(document.getElementById('dvs-format').value));
  diffBtn.addEventListener('click', () => showRowDiff(srcRows, tgtRows));
  document.getElementById('open-rules').addEventListener('click', () => openRulesEditor(() => runValidation()));
  document.getElementById('clear-dvs').addEventListener('click', () => {
    delete ws().saved.dvs;
    persist(); renderPage(); renderNav();
  });
}

function openRulesEditor(onSave) {
  const rules = JSON.parse(JSON.stringify(ws().customRules));

  function renderRules() {
    document.getElementById('rules-body').innerHTML = rules.map((r, i) => `
      <div class="rule-row">
        <input type="checkbox" data-i="${i}" ${r.enabled ? 'checked' : ''} class="rule-enable" />
        <select class="input rule-type" data-i="${i}">
          <option value="row-count"  ${r.type === 'row-count'  ? 'selected' : ''}>Row count match</option>
          <option value="column-set" ${r.type === 'column-set' ? 'selected' : ''}>Column set match</option>
          <option value="no-nulls"   ${r.type === 'no-nulls'   ? 'selected' : ''}>No nulls</option>
          <option value="regex"      ${r.type === 'regex'      ? 'selected' : ''}>Regex on column</option>
          <option value="unique"     ${r.type === 'unique'     ? 'selected' : ''}>Unique values</option>
          <option value="range"      ${r.type === 'range'      ? 'selected' : ''}>Numeric range</option>
        </select>
        ${['no-nulls','regex','unique','range'].includes(r.type) ? `<input class="input rule-col" data-i="${i}" placeholder="column" value="${escapeHtml(r.column || '')}" />` : ''}
        ${r.type === 'regex' ? `<input class="input rule-pattern" data-i="${i}" placeholder="pattern" value="${escapeHtml(r.pattern || '')}" />` : ''}
        ${r.type === 'range' ? `<input class="input rule-min" data-i="${i}" placeholder="min" value="${escapeHtml(r.min || 0)}" style="width:60px;" /><input class="input rule-max" data-i="${i}" placeholder="max" value="${escapeHtml(r.max || 100)}" style="width:60px;" />` : ''}
        <button class="btn danger sm" data-del="${i}">×</button>
      </div>`).join('');

    document.querySelectorAll('.rule-enable').forEach(el  => el.addEventListener('change', e  => { rules[+e.target.dataset.i].enabled = e.target.checked; }));
    document.querySelectorAll('.rule-type').forEach(el    => el.addEventListener('change', e  => { rules[+e.target.dataset.i].type    = e.target.value;   renderRules(); }));
    document.querySelectorAll('.rule-col').forEach(el     => el.addEventListener('input',  e  => { rules[+e.target.dataset.i].column  = e.target.value; }));
    document.querySelectorAll('.rule-pattern').forEach(el => el.addEventListener('input',  e  => { rules[+e.target.dataset.i].pattern = e.target.value; }));
    document.querySelectorAll('.rule-min').forEach(el     => el.addEventListener('input',  e  => { rules[+e.target.dataset.i].min     = e.target.value; }));
    document.querySelectorAll('.rule-max').forEach(el     => el.addEventListener('input',  e  => { rules[+e.target.dataset.i].max     = e.target.value; }));
    document.querySelectorAll('[data-del]').forEach(el    => el.addEventListener('click',  e  => { rules.splice(+e.target.dataset.del, 1); renderRules(); }));
  }

  openModal(`
    <h3>Custom validation rules</h3>
    <p>Define checks beyond row count and column match.</p>
    <div id="rules-body"></div>
    <div class="buttons-row"><button class="btn outline sm" id="add-rule">+ Add rule</button></div>
    <div class="modal-actions">
      <button class="btn outline" id="rules-cancel">Cancel</button>
      <button class="btn primary" id="rules-save">Save & re-run</button>
    </div>
  `);
  renderRules();
  document.getElementById('add-rule').addEventListener('click', () => {
    rules.push({ id: 'r' + Date.now(), enabled: true, type: 'no-nulls', column: '', description: 'Custom rule' });
    renderRules();
  });
  document.getElementById('rules-cancel').addEventListener('click', closeModal);
  document.getElementById('rules-save').addEventListener('click', () => {
    ws().customRules = rules; persist(); closeModal();
    if (onSave) onSave();
    toast('Rules saved (' + rules.filter(r => r.enabled).length + ' active)', 'success');
  });
}

function showRowDiff(src, tgt) {
  if (!src.length || !tgt.length) { toast('Need both source and target', 'warn'); return; }
  const cols  = Array.from(new Set([...Object.keys(src[0] || {}), ...Object.keys(tgt[0] || {})]));
  const limit = Math.min(Math.max(src.length, tgt.length), 60);

  openModal(`
    <h3>Row-level diff (first ${limit} of ${Math.max(src.length, tgt.length)})</h3>
    <p>Cells highlighted in <span class="pill warn">amber</span> differ between source and target.</p>
    <div class="table-wrapper" style="max-height:60vh;">
      <table class="table">
        <thead>
          <tr><th>#</th>${cols.map(c => `<th colspan="2">${escapeHtml(c)}</th>`).join('')}</tr>
          <tr><th></th>${cols.map(() => '<th>src</th><th>tgt</th>').join('')}</tr>
        </thead>
        <tbody>
          ${Array.from({ length: limit }, (_, i) => {
            const s = src[i] || {}, t = tgt[i] || {};
            return `<tr><td>${i + 1}</td>${cols.map(c => {
              const sv = s[c] == null ? '' : String(s[c]);
              const tv = t[c] == null ? '' : String(t[c]);
              const diff = sv !== tv;
              return `<td class="${diff ? 'diff-mod' : ''}">${escapeHtml(sv)}</td><td class="${diff ? 'diff-mod' : ''}">${escapeHtml(tv)}</td>`;
            }).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions"><button class="btn outline" id="rd-close">Close</button></div>
  `);
  document.getElementById('rd-close').addEventListener('click', closeModal);
}

function exportDvs(fmt) {
  if (!ws().saved.dvs) return;
  const rows = ws().saved.dvs.summary;
  if (fmt === 'xlsx') {
    saveWorkbook(rows, 'validation_output.xlsx');
  } else if (fmt === 'html') {
    const headers = Object.keys(rows[0]);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Data Validation Report</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px}
h1{margin-top:0}
table{border-collapse:collapse;width:100%;background:#1e293b;border-radius:12px;overflow:hidden}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #334155}
th{background:#334155;color:#cbd5e1;text-transform:uppercase;font-size:12px;letter-spacing:.05em}
.pill{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;text-transform:uppercase}
.passed{background:#064e3b;color:#6ee7b7}.failed{background:#7f1d1d;color:#fca5a5}.warn{background:#78350f;color:#fcd34d}
</style></head><body>
<h1>Data Validation Report</h1>
<p>Workspace: ${escapeHtml(ws().name)} · Generated: ${new Date().toISOString()}</p>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
${rows.map(r => `<tr>${headers.map(h => h === 'Status' ? `<td><span class="pill ${r[h]}">${r[h]}</span></td>` : `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`).join('')}
</tbody></table></body></html>`;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'validation_output.html');
  } else {
    saveText(
      'Data Validation Report\n' + '='.repeat(60) + '\nWorkspace: ' + ws().name + '\nGenerated: ' + new Date().toISOString() + '\n\n' +
      rows.map(r => `${r.Metric}: source=${r.Source} | target=${r.Target} | status=${r.Status}`).join('\n'),
      'validation_output.txt'
    );
  }
}
