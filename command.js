/* Pearland Fire Link — Command module
   Phase 1: skeleton and the log. No board, no timers yet.

   The event log is the database. Every action appends an immutable entry;
   the screen is a projection of that array, re-rendered from scratch on
   every change. State is persisted synchronously after every append, so a
   dead battery or an evicted tab costs nothing. See COMMAND-MODULE-PLAN.md. */

const STORAGE_KEY = 'pfd-cmd-active';
const SCHEMA_V = 1;

const OCC_LABEL = {
  'single-family': 'Single Family',
  'multi-family':  'Multi-Family',
  'commercial':    'Commercial / Big-Box',
  'strip-mall':    'Strip Mall',
  'high-rise':     'High Rise',
  'other':         'Other'
};

/* ---------- state ---------- */

function loadState(){
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || d.v !== SCHEMA_V || !Array.isArray(d.log)) {
    // A future version (or corrupt write) that this code can't read is
    // discarded outright rather than half-loaded. An incident in progress
    // during an app update is an edge case worth this line, not cleverness.
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    return null;
  }
  return d;
}

function saveState(d){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function clearState(){
  localStorage.removeItem(STORAGE_KEY);
}

function newIncident(occupancy, address){
  const now = Date.now();
  return {
    v: SCHEMA_V,
    id: 'inc-' + now,
    startedAt: now,
    occupancy,
    address: address || '',
    commandMode: null,
    opMode: null,
    parDue: null,
    parIntervalMin: 15,
    log: [
      { t: now, kind: 'incident-start', occupancy, address: address || '' }
    ]
  };
}

function appendEntry(state, entry){
  state.log.push(entry);
  saveState(state);
}

/* ---------- entry -> timeline text ---------- */

function describeEntry(e){
  switch (e.kind) {
    case 'incident-start':
      return 'Incident started' + (e.address ? ' — ' + e.address : '') +
             ' (' + (OCC_LABEL[e.occupancy] || e.occupancy) + ')';
    case 'note':
      return e.text;
    case 'incident-end':
      return 'Incident ended';
    default:
      return e.kind;
  }
}

function fmtTime(t){
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* ---------- render ---------- */

let state = loadState();

const $ = id => document.getElementById(id);
const startScreen  = $('start-screen');
const activeScreen = $('active-screen');

function render(){
  if (!state) {
    startScreen.hidden = false;
    activeScreen.hidden = true;
    return;
  }
  startScreen.hidden = true;
  activeScreen.hidden = false;

  $('a-occ').textContent  = OCC_LABEL[state.occupancy] || state.occupancy;
  $('a-addr').textContent = state.address || '(no address given)';
  $('a-since').textContent = 'Started ' +
    new Date(state.startedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

  const tl = $('timeline');
  if (state.log.length === 0) {
    tl.innerHTML = '<div class="empty">Nothing logged yet.</div>';
  } else {
    // newest first — the thing you just did should be visible without scrolling
    tl.innerHTML = state.log.slice().reverse().map(e =>
      `<li><span class="tm">${fmtTime(e.t)}</span><span class="tx">${escapeHTML(describeEntry(e))}</span></li>`
    ).join('');
  }
}

function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- actions ---------- */

$('btn-start').addEventListener('click', () => {
  const occ  = $('f-occ').value;
  const addr = $('f-addr').value.trim();
  state = newIncident(occ, addr);
  saveState(state);
  $('f-addr').value = '';
  render();
});

$('btn-note').addEventListener('click', addNote);
$('f-note').addEventListener('keydown', e => { if (e.key === 'Enter') addNote(); });

function addNote(){
  const input = $('f-note');
  const text = input.value.trim();
  if (!text || !state) return;
  appendEntry(state, { t: Date.now(), kind: 'note', text });
  input.value = '';
  render();
}

$('btn-end').addEventListener('click', () => {
  if (!state) return;
  if (!confirm('End this incident? This clears the active incident from this device.')) return;
  appendEntry(state, { t: Date.now(), kind: 'incident-end' });
  clearState();
  state = null;
  render();
});

render();
