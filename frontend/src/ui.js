function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ 
    '&': '&amp;', 
    '<': '&lt;', 
    '>': '&gt;', 
    '"': '&quot;', 
    "'": '&#39;' 
  }[c]));
}

function truncate(s, n) { 
  return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s); 
}

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return; // Guard clause against missing container
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '⚠' : 'i';
  el.innerHTML = `<span style="font-weight:700;">${icon}</span><span>${escapeHtml(message)}</span><span class="close">×</span>`;
  el.querySelector('.close').addEventListener('click', () => el.remove());
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 250); }, 3800);
}

function openModal(html, onClose) {
  const c = document.getElementById('modal-container');
  if (!c) return;
  c.innerHTML = `<div class="modal-card">${html}</div>`;
  c.classList.add('open');
  c.onclick = (e) => { if (e.target === c) closeModal(); };
  c._onClose = onClose;
}

function closeModal() {
  const c = document.getElementById('modal-container');
  if (!c) return;
  c.classList.remove('open');
  c.innerHTML = '';
  if (c._onClose) c._onClose();
}

function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

function readWorkbook(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => {
      try { res(XLSX.read(new Uint8Array(e.target.result), { type: 'array' })); }
      catch (err) { rej(err); }
    };
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function workbookToJson(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

function parseFileToRows(file) {
  return new Promise((res, rej) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      readWorkbook(file).then(wb => res(workbookToJson(wb))).catch(rej);
    } else if (ext === 'csv' || ext === 'txt') {
      readFileAsText(file).then(t => res(workbookToJson(XLSX.read(t, { type: 'string' })))).catch(rej);
    } else if (ext === 'pbix') {
      // pbix files are binaries; reading as text usually fails or produces garbled data.
      // Handled safely here to avoid breaking execution.
      readFileAsText(file).then(t => {
        try { 
          const j = JSON.parse(t); 
          res(Array.isArray(j) ? j : (j.rows || [j])); 
        } catch (_) { 
          res([{ File: file.name, Note: 'binary pbix (preview unavailable)' }]); 
        }
      }).catch(() => {
        res([{ File: file.name, Note: 'binary pbix (preview unavailable)' }]);
      });
    } else {
      rej(new Error('Unsupported file type: .' + ext));
    }
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
  toast('Downloaded ' + filename, 'success');
}

function saveWorkbook(rows, filename) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([data], { type: 'application/octet-stream' }), filename);
}

function saveCsv(rows, filename) {
  const ws_ = XLSX.utils.json_to_sheet(rows);
  downloadBlob(new Blob([XLSX.utils.sheet_to_csv(ws_)], { type: 'text/csv;charset=utf-8' }), filename);
}

function saveText(text, filename) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}

function attachDropZone(zoneId, inputId, onFiles, multiple) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) { console.warn('[dropzone] missing element', zoneId, inputId); return; }
  if (multiple) input.multiple = true;
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', e => { if (e.dataTransfer.files.length) onFiles(multiple ? Array.from(e.dataTransfer.files) : e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files.length) onFiles(multiple ? Array.from(input.files) : input.files[0]); });
}

function fileChip(name) { return `<div class="file-chip">📄 ${escapeHtml(name)}</div>`; }

function renderSearchableTable(container, rows, columns, opts = {}) {
  if (!container) return;
  if (!rows || !rows.length) { container.innerHTML = '<div class="note">No data to display.</div>'; return; }
  const cols = columns || Object.keys(rows[0]);
  const id = 'tbl-' + Math.random().toString(36).slice(2, 9);
  const localState = { rows, cols, sortCol: null, sortDir: 1, query: '', wide: opts.wideCols || [], id };

  container.innerHTML = `
    <div class="table-toolbar">
      <div class="search-input"><span style="opacity:0.6;">🔍</span><input type="text" placeholder="Search rows..." id="${id}-search" /></div>
      <div style="font-size:11px; color:var(--text-mute);" id="${id}-count">${rows.length} rows</div>
    </div>
    <div id="${id}-tbl"></div>
  `;

  function paint() {
    const filtered = localState.query ? localState.rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(localState.query))) : localState.rows;
    const sorted = localState.sortCol ? [...filtered].sort((a, b) => {
      const av = a[localState.sortCol], bv = b[localState.sortCol];
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * localState.sortDir;
      return String(av).localeCompare(String(bv)) * localState.sortDir;
    }) : filtered;
    
    const limited = sorted.slice(0, 100);
    const tblContainer = document.getElementById(id + '-tbl');
    if (!tblContainer) return;

    tblContainer.innerHTML = `
      <div class="table-wrapper"><table class="table">
        <thead><tr>${cols.map(c => `<th data-col="${escapeHtml(c)}" class="${localState.sortCol === c ? 'sorted' : ''}">${escapeHtml(c)}<span class="sort-arr">${localState.sortCol === c ? (localState.sortDir > 0 ? '▲' : '▼') : '▲▼'}</span></th>`).join('')}</tr></thead>
        <tbody>${limited.map(r => `<tr>${cols.map(c => {
          const v = r[c];
          const esc = escapeHtml(v);
          const hi = localState.query
            ? esc.replace(new RegExp('(' + localState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>')
            : esc;
          return localState.wide.includes(c) ? `<td class="wide"><code>${hi}</code></td>` : `<td>${hi}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${sorted.length > 100 ? `<div class="note" style="margin-top:8px;">Showing first 100 of ${sorted.length} matching rows.</div>` : ''}
    `;

    const countContainer = document.getElementById(id + '-count');
    if (countContainer) countContainer.textContent = sorted.length + ' / ' + localState.rows.length + ' rows';
    
    document.querySelectorAll('#' + id + '-tbl th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        if (localState.sortCol === th.dataset.col) localState.sortDir = -localState.sortDir;
        else { localState.sortCol = th.dataset.col; localState.sortDir = 1; }
        paint();
      });
    });
  }

  const searchInput = document.getElementById(id + '-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => { localState.query = e.target.value.toLowerCase(); paint(); });
  }
  paint();
}