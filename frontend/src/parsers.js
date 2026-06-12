function parseSqlReports(text, sourceFile) {
  const stmts = text.split(/;(?![^(]*\))/g).map(s => s.trim()).filter(Boolean);
  return stmts.map((stmt, i) => {
    const nameMatch = stmt.match(/(?:--|\/\*)\s*report\s*name\s*:\s*(.+?)(?:\r?\n|$)/i);
    const idMatch   = stmt.match(/(?:--|\/\*)\s*report\s*id\s*:\s*(.+?)(?:\r?\n|$)/i);
    const reportName = nameMatch ? nameMatch[1].trim() : deriveReportName(stmt, i);
    const reportId   = idMatch   ? idMatch[1].trim()   : 'RPT-' + String(i + 1).padStart(3, '0');
    const stripped = stmt
      .replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '')
      .replace(/^(?:\s*--[^\n]*\r?\n?)+/, '');
    const row = { 'Report Name': reportName, 'Report ID': reportId, 'Query': stripped.replace(/\s+/g, ' ').trim() };
    if (sourceFile) row['Source File'] = sourceFile;
    return row;
  });
}

function deriveReportName(sql, i) {
  const m = sql.match(/from\s+([\w\[\]`\.]+)/i);
  if (m) return 'Report_' + m[1].replace(/[`\[\]]/g, '').replace(/\./g, '_');
  return 'Report_' + (i + 1);
}

function parseLineage(text) {
  const stmts = text.split(/;(?![^(]*\))/g).map(s => s.trim()).filter(Boolean);
  const rows = [];
  stmts.forEach((stmt, i) => {
    const nameMatch = stmt.match(/(?:--|\/\*)\s*report\s*name\s*:\s*(.+?)(?:\r?\n|$)/i);
    const report = nameMatch ? nameMatch[1].trim() : deriveReportName(stmt, i);
    const selectMatch = stmt.match(/select\s+([\s\S]+?)\s+from\s+/i);
    const cols = selectMatch
      ? selectMatch[1].split(/\s*,\s*/).map(c => c.replace(/\s+as\s+[^\s]+$/i, '').trim()).filter(Boolean)
      : ['*'];
    const tables = Array.from(stmt.matchAll(/(?:from|join)\s+([\w\[\]`\.]+)/gi)).map(m => m[1].replace(/[`\[\]]/g, ''));
    if (!tables.length) tables.push('Unknown');
    tables.forEach(t => cols.forEach(c => rows.push({ Report: report, 'Source Table': t, 'Source Column': c })));
  });
  return rows;
}

function processRationalize(rows) {
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const filtered = rows.filter(r => r['Report Name'] || r['report name'] || r['ReportName'] || r['Query'] || r['query']);
  const seen = new Set();
  const unique = [];
  filtered.forEach(r => {
    const id    = norm(r['Report ID']   || r['report id']);
    const name  = norm(r['Report Name'] || r['report name'] || r['ReportName']);
    const query = norm(r['Query']       || r['query']).replace(/\s+/g, ' ');
    const key = (id || name) ? (id + '|' + name) : query;
    if (!seen.has(key)) { seen.add(key); unique.push(r); }
  });
  return { unique, dupRemoved: filtered.length - unique.length, unusedRemoved: rows.length - filtered.length };
}

function buildMapping(rows, leftKeys, rightKeys, leftLabel, rightLabel) {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const norm = s => s.trim().toLowerCase().replace(/[_\s]+/g, ' ');
  const find = keys => headers.find(h => keys.includes(norm(h)));
  const lh = find(leftKeys.map(norm))  || headers[0];
  const rh = find(rightKeys.map(norm)) || headers[1] || headers[0];
  return rows.map(r => ({ [leftLabel]: r[lh] || '', [rightLabel]: r[rh] || '' }))
             .filter(r => r[leftLabel] || r[rightLabel]);
}

function generateMQuery(rows, fileName) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const safeName = fileName.replace(/[^a-zA-Z0-9]/g, '_');
  const renames = columns.map(c => `        {"${c}", type text}`).join(',\n');
  return `// Auto-generated M Query for ${fileName}
// Generated on ${new Date().toISOString()}

let
    Source = Excel.Workbook(File.Contents("${fileName}"), null, true),
    Sheet = Source{[Name="Sheet1"]}[Data],
    PromotedHeaders = Table.PromoteHeaders(Sheet, [PromoteAllScalars=true]),
    ChangedTypes = Table.TransformColumnTypes(PromotedHeaders, {
${renames}
    }),
    FilteredRows = Table.SelectRows(ChangedTypes, each List.NonNullCount(Record.FieldValues(_)) > 0),
    RemovedDuplicates = Table.Distinct(FilteredRows)
in
    RemovedDuplicates

// Table: ${safeName}
// Columns: ${columns.join(', ')}`;
}

function applyRules(src, tgt, rules) {
  const sCols = Object.keys(src[0] || {});
  const tCols = Object.keys(tgt[0] || {});
  const out = [];
  rules.filter(r => r.enabled).forEach(rule => {
    if (rule.type === 'row-count') {
      out.push({ Metric: 'Row count', Source: src.length, Target: tgt.length, Status: src.length === tgt.length ? 'passed' : 'failed' });
    } else if (rule.type === 'column-set') {
      const match = sCols.length === tCols.length && sCols.every(c => tCols.includes(c));
      out.push({ Metric: 'Column set match', Source: sCols.join(', '), Target: tCols.join(', '), Status: match ? 'passed' : 'failed' });
    } else if (rule.type === 'no-nulls') {
      const sN = countNulls(src), tN = countNulls(tgt);
      out.push({ Metric: 'Null check (' + (rule.column || '*') + ')', Source: 'source nulls: ' + sN, Target: 'target nulls: ' + tN, Status: (sN + tN) === 0 ? 'passed' : 'warn' });
    } else if (rule.type === 'regex' && rule.column && rule.pattern) {
      const re = new RegExp(rule.pattern);
      const sBad = src.filter(r => !re.test(String(r[rule.column] || ''))).length;
      const tBad = tgt.filter(r => !re.test(String(r[rule.column] || ''))).length;
      out.push({ Metric: 'Regex: ' + rule.column, Source: 'fails: ' + sBad, Target: 'fails: ' + tBad, Status: (sBad + tBad) === 0 ? 'passed' : 'failed' });
    } else if (rule.type === 'unique' && rule.column) {
      const sU = new Set(src.map(r => r[rule.column])).size === src.length;
      const tU = new Set(tgt.map(r => r[rule.column])).size === tgt.length;
      out.push({ Metric: 'Unique: ' + rule.column, Source: sU ? 'unique' : 'duplicates', Target: tU ? 'unique' : 'duplicates', Status: sU && tU ? 'passed' : 'failed' });
    } else if (rule.type === 'range' && rule.column) {
      const min = parseFloat(rule.min), max = parseFloat(rule.max);
      const check = rows => rows.filter(r => { const v = parseFloat(r[rule.column]); return isNaN(v) || v < min || v > max; }).length;
      out.push({ Metric: 'Range [' + min + ',' + max + '] ' + rule.column, Source: 'out: ' + check(src), Target: 'out: ' + check(tgt), Status: (check(src) + check(tgt)) === 0 ? 'passed' : 'failed' });
    }
  });
  return out;
}

function countNulls(rows) {
  let n = 0;
  rows.forEach(r => Object.values(r).forEach(v => { if (v === null || v === undefined || String(v).trim() === '') n++; }));
  return n;
}
