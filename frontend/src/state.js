const STORAGE_KEY = 'bi-studio-state-v1';

function defaultRules() {
  return [
    { id: 'r1', enabled: true, type: 'row-count',  description: 'Row counts must match' },
    { id: 'r2', enabled: true, type: 'column-set', description: 'Column sets must match' },
    { id: 'r3', enabled: true, type: 'no-nulls',   column: '*', description: 'No null/empty cells (any column)' },
  ];
}

function defaultWorkspace(name) {
  return {
    name,
    createdAt: new Date().toISOString(),
    saved: {},
    activity: [],
    mappingHistory: { table: [], column: [] },
    customRules: defaultRules(),
    rawSqlText: '',
  };
}

const state = {
  activeId: 'dashboard',
  workspaces: { default: defaultWorkspace('Default') },
  activeWorkspace: 'default',
  theme: 'dark',
  autoChain: true,
};

function ws() { return state.workspaces[state.activeWorkspace]; }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaces: state.workspaces,
      activeWorkspace: state.activeWorkspace,
      theme: state.theme,
      autoChain: state.autoChain,
      activeId: state.activeId,
    }));
  } catch (e) { console.warn('persist failed', e); }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.workspaces && Object.keys(parsed.workspaces).length) state.workspaces = parsed.workspaces;
    state.activeWorkspace = parsed.activeWorkspace || 'default';
    state.theme = parsed.theme || 'dark';
    state.autoChain = parsed.autoChain !== false;
    state.activeId = parsed.activeId || 'dashboard';
    Object.values(state.workspaces).forEach(w => {
      if (!w.customRules) w.customRules = defaultRules();
      if (!w.mappingHistory) w.mappingHistory = { table: [], column: [] };
    });
  } catch (e) { console.warn('load failed', e); }
}

function logActivity(text) {
  ws().activity.unshift({ text, time: new Date().toISOString() });
  ws().activity = ws().activity.slice(0, 12);
  persist();
}

function fmtTime(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleString();
}
