/* Pearland Fire Link — Command module
   Phase 1: skeleton and the log.
   Phase 2: elapsed clock, PAR countdown, Wake Lock.
   Phase 3: accountability board, roles, command transfer, resources.
   Reads ROSTER / SPECIAL_UNITS / POSITIONS from roster.js.

   The event log is the database. Every action appends an immutable entry;
   the screen is a projection of that array, re-rendered from scratch on
   every change. State is persisted synchronously after every append, so a
   dead battery or an evicted tab costs nothing. See COMMAND-MODULE-PLAN.md.

   Clocks are never counted with a timer — always derived from stored
   epoch timestamps (Date.now() - startedAt). setInterval throttles or
   stops when the phone locks or the PWA backgrounds; a tick that never
   fires costs a stale display, not a wrong number, and self-corrects the
   moment the screen comes back (see the visibilitychange handler below). */

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

// Declared here, at the top, because several sections below register
// event listeners at the top level of the script (not inside a function)
// — those run immediately as the file is parsed, so $ has to exist
// before them. Everything else in this file is a function declaration
// (hoisted), so it can reference $ regardless of where it's defined.
const $ = id => document.getElementById(id);
let state = loadState();

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
    // The 15-minute PAR requirement (307.3.2(g)1(f)) runs continuously
    // from the moment command is established, so the clock starts here
    // rather than waiting for a separate "start PAR" action.
    parDue: now + 15 * 60000,
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

function roleLabel(role){
  if (role === 'safety') return 'Safety Officer';
  if (role === 'accountability') return 'Accountability Officer';
  return role;
}

function describeEntry(e){
  switch (e.kind) {
    case 'incident-start':
      return 'Incident started' + (e.address ? ' — ' + e.address : '') +
             ' (' + (OCC_LABEL[e.occupancy] || e.occupancy) + ')';
    case 'note':
      return e.text;
    case 'par':
      return 'PAR complete';
    case 'unit-arrive':
      return e.unit + ' (' + e.personnel + ') on scene';
    case 'unit-split':
      return e.unit + ' split — ' + e.into
        .map(h => h.name.replace(e.unit + ' — ', '') + ' (' + h.personnel + ')')
        .join(', ');
    case 'unit-merge':
      return e.unit + ' — crew merged back together';
    case 'assign':
      return e.unit + ' → ' + e.to;
    case 'unit-clear':
      return e.unit + ' cleared from board';
    case 'role':
      return roleLabel(e.role) + ': ' + e.who;
    case 'resource':
      return (SPECIAL_UNITS[e.which] || e.which) + ' ' +
             (e.state === 'onScene' ? 'on scene' : 'requested');
    case 'command-transfer':
      return 'Command transferred to ' + e.to;
    case 'incident-end':
      return 'Incident ended';
    default:
      return e.kind;
  }
}

/* ---------- board ---------- */
/* The board is a projection of the log, never its own source of truth.
   Every render replays the whole log from scratch — see the plan's
   architectural rule. Incident logs are short enough that this is cheap;
   don't be tempted to maintain board state incrementally alongside it. */

function deriveBoard(log){
  const units = {};        // name -> { personnel, position, splitOf? }
  const splitsOf = {};     // base unit name -> [halfName, halfName] while split
  const roles = { safety: null, accountability: null };
  const resources = { fmo: {}, centerpoint: {} };
  let commandTransferredTo = null;

  for (const e of log) {
    switch (e.kind) {
      case 'unit-arrive':
        units[e.unit] = { personnel: e.personnel, position: 'Staging' };
        break;
      case 'unit-split':
        delete units[e.unit];
        splitsOf[e.unit] = e.into.map(h => h.name);
        e.into.forEach(h => {
          units[h.name] = { personnel: h.personnel, position: 'Staging', splitOf: e.unit };
        });
        break;
      case 'unit-merge': {
        const halves = splitsOf[e.unit] || [];
        let total = 0;
        halves.forEach(h => { if (units[h]) total += units[h].personnel; delete units[h]; });
        delete splitsOf[e.unit];
        units[e.unit] = { personnel: total, position: 'Staging' };
        break;
      }
      case 'assign':
        if (units[e.unit]) units[e.unit].position = e.to;
        break;
      case 'unit-clear':
        delete units[e.unit];
        break;
      case 'role':
        if (e.role === 'safety' || e.role === 'accountability') roles[e.role] = e.who;
        break;
      case 'resource':
        if (resources[e.which]) resources[e.which][e.state] = e.t;
        break;
      case 'command-transfer':
        commandTransferredTo = e.to;
        break;
      default:
        break;
    }
  }
  return { units, splitsOf, roles, resources, commandTransferredTo };
}

function defaultCrewFor(name){
  const r = ROSTER.find(x => x.unit === name);
  return r ? r.defaultCrew : 4;
}

function fmtTime(t){
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtHMS(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function fmtMS(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/* ---------- clocks ---------- */
/* tick() only touches the clock text nodes and the overdue banner — it
   runs every second and must stay cheap. render() rebuilds the timeline
   and only runs when the log actually changes. */

let tickTimer = null;
let lastChimedParDue = null;

function tick(){
  if (!state) return;

  $('c-elapsed').textContent = fmtHMS(Date.now() - state.startedAt);

  const remain = state.parDue - Date.now();
  const parEl = $('c-par');
  const banner = $('par-banner');

  if (remain > 0) {
    parEl.textContent = 'PAR in ' + fmtMS(remain);
    parEl.classList.remove('overdue');
    banner.innerHTML = '';
  } else {
    const overMs = -remain;
    const mins = Math.floor(overMs / 60000);
    parEl.textContent = 'PAR overdue ' + fmtMS(overMs);
    parEl.classList.add('overdue');
    banner.innerHTML =
      '<div class="flag urgent"><span>▲</span><span><b>PAR overdue.</b> Due ' +
      (mins < 1 ? 'less than a minute' : mins + ' minute' + (mins === 1 ? '' : 's')) +
      ' ago.</span></div>';

    // Chime is a bonus for when the screen happens to be on — never the
    // safety mechanism. A locked/backgrounded PWA can't be counted on to
    // play it, which is why the banner above is the thing that actually
    // has to work. Fires once per PAR due time, not once per tick.
    if (lastChimedParDue !== state.parDue && document.visibilityState === 'visible') {
      playChime();
      lastChimedParDue = state.parDue;
    }
  }
}

function startTicking(){
  if (tickTimer) return;
  tick();
  tickTimer = setInterval(tick, 1000);
}

function stopTicking(){
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state) {
    // Correct immediately on return rather than waiting for the next
    // tick — a stale number for even a second undermines the clock.
    tick();
    acquireWakeLock();
  }
});

/* ---------- wake lock ---------- */
/* Keeps the screen on while an incident is active so the overdue banner
   above is actually visible instead of behind a lock screen. Silently
   does nothing where unsupported — this is a nicety, not a dependency. */

let wakeLock = null;

async function acquireWakeLock(){
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    // Commonly rejects if the document isn't visible at request time;
    // the visibilitychange handler retries on return, so just move on.
  }
}

function releaseWakeLock(){
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* ---------- chime ---------- */
/* Web Audio requires a user gesture before it will produce sound. The
   context is created and resumed inside the Start Incident click handler
   (a real gesture) and reused for chimes fired later from the tick loop,
   which has no gesture of its own. */

let audioCtx = null;

function ensureAudioCtx(){
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  audioCtx = new AC();
  return audioCtx;
}

function playChime(){
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [880, 660].forEach((freq, i) => {
    const start = now + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

/* ---------- sheet (bottom action sheet, reused for every picker) ---------- */
/* sheetCtx carries just enough to know which handler a tap belongs to —
   see the .type checks in handleSheetOption() and the confirm buttons
   below. Sheet content is thrown away and rebuilt on every open/step. */

let sheetCtx = null;

function setSheetContent(title, html){
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
}

function openSheet(title, html){
  setSheetContent(title, html);
  $('sheet-backdrop').hidden = false;
}

function closeSheet(){
  $('sheet-backdrop').hidden = true;
  $('sheet-title').textContent = '—';
  $('sheet-body').innerHTML = '';
  sheetCtx = null;
}

/* ---------- roles + command ---------- */
/* Pinned above the board rather than assigned like a division, because
   307.3.2(a)1 makes the IC directly responsible for these. */

function renderRoles(){
  const { roles, commandTransferredTo } = deriveBoard(state.log);
  $('roles-row').innerHTML = `
    <button type="button" class="rolechip${roles.safety ? ' set' : ''}" data-role-chip="safety">
      <span class="rl">Safety</span><span class="rv">${escapeHTML(roles.safety || 'Not set')}</span>
    </button>
    <button type="button" class="rolechip${roles.accountability ? ' set' : ''}" data-role-chip="accountability">
      <span class="rl">Accountability</span><span class="rv">${escapeHTML(roles.accountability || 'Not set')}</span>
    </button>
    <button type="button" class="rolechip${commandTransferredTo ? ' set' : ''}" data-role-chip="command">
      <span class="rl">Command</span><span class="rv">${escapeHTML(commandTransferredTo || 'IC')}</span>
    </button>
  `;
}

function openRoleSheet(role){
  const { units } = deriveBoard(state.log);
  const unitOpts = Object.keys(units).map(u =>
    `<button type="button" class="sheet-opt" data-opt="role-pick" data-value="${escapeHTML(u)}">${escapeHTML(u)}</button>`
  ).join('') || '<div class="board-empty">No units on the board yet.</div>';
  sheetCtx = { type: 'role', role };
  openSheet(roleLabel(role), `
    <div class="sheet-group">On-scene units</div>
    ${unitOpts}
    <div class="sheet-group">Other</div>
    <div class="noterow">
      <input type="text" id="sheet-role-free" placeholder="Name or unit" autocomplete="off">
      <button type="button" id="sheet-role-free-go">Set</button>
    </div>
  `);
}

function setRoleFree(){
  if (!state || !sheetCtx || sheetCtx.type !== 'role') return;
  const val = $('sheet-role-free').value.trim();
  if (!val) return;
  appendEntry(state, { t: Date.now(), kind: 'role', role: sheetCtx.role, who: val });
  closeSheet();
  render();
}

$('roles-row').addEventListener('click', e => {
  const chip = e.target.closest('[data-role-chip]');
  if (!chip || !state) return;
  const kind = chip.dataset.roleChip;
  if (kind === 'command') {
    // One tap. Battalion 1 is the only transfer target this module
    // knows about; once transferred there's nothing to toggle back to
    // safely, so a set chip is inert rather than reversible here.
    const { commandTransferredTo } = deriveBoard(state.log);
    if (commandTransferredTo) return;
    appendEntry(state, { t: Date.now(), kind: 'command-transfer', to: SPECIAL_UNITS.battalion });
    render();
    return;
  }
  openRoleSheet(kind);
});

/* ---------- board ui ---------- */

function renderBoard(){
  const { units } = deriveBoard(state.log);
  const boardEl = $('board');
  const names = Object.keys(units);
  if (names.length === 0) {
    boardEl.innerHTML = '<div class="board-empty">No units on the board yet.</div>';
    return;
  }
  const byPos = {};
  names.forEach(n => {
    const pos = units[n].position || 'Staging';
    (byPos[pos] = byPos[pos] || []).push(n);
  });
  const positions = Object.keys(byPos).sort((a, b) => {
    if (a === 'Staging') return -1;
    if (b === 'Staging') return 1;
    return 0;
  });
  boardEl.innerHTML = positions.map(pos => `
    <div class="poshead">${escapeHTML(pos)}</div>
    <div class="unitrow">
      ${byPos[pos].map(n =>
        `<button type="button" class="unittile" data-unit="${escapeHTML(n)}">${escapeHTML(n)}<span class="pc">(${units[n].personnel})</span></button>`
      ).join('')}
    </div>
  `).join('');
}

function openAssignSheet(unitName){
  const { units } = deriveBoard(state.log);
  const u = units[unitName];
  if (!u) return;
  const rosterEntry = ROSTER.find(r => r.unit === unitName);
  const canSplit = !!rosterEntry && rosterEntry.splits && !u.splitOf;
  const canUnsplit = !!u.splitOf;
  sheetCtx = { type: 'assign', unit: unitName, mergeBase: u.splitOf || null };

  let extra = '';
  if (canSplit) {
    extra += `<button type="button" class="sheet-opt" data-opt="split">Split Crew — Low Side / High Side</button>`;
  }
  if (canUnsplit) {
    extra += `<button type="button" class="sheet-opt" data-opt="unsplit">Unsplit — merge back to ${escapeHTML(u.splitOf)}</button>`;
  }

  const groups = POSITIONS.map(g => `
    <div class="sheet-group">${escapeHTML(g.group)}</div>
    ${g.items.map(p =>
      `<button type="button" class="sheet-opt" data-opt="assign-pick" data-value="${escapeHTML(p)}">${escapeHTML(p)}</button>`
    ).join('')}
  `).join('');

  openSheet(unitName + ' (' + u.personnel + ')', `
    ${extra}
    ${groups}
    <div class="sheet-group">Other</div>
    <div class="noterow">
      <input type="text" id="sheet-assign-free" placeholder="Custom position" autocomplete="off">
      <button type="button" id="sheet-assign-free-go">Assign</button>
    </div>
    <button type="button" class="sheet-opt destructive" data-opt="clear-unit" style="margin-top:14px">
      Clear ${escapeHTML(unitName)} from board
    </button>
  `);
}

function setAssignFree(){
  if (!state || !sheetCtx || sheetCtx.type !== 'assign') return;
  const val = $('sheet-assign-free').value.trim();
  if (!val) return;
  appendEntry(state, { t: Date.now(), kind: 'assign', unit: sheetCtx.unit, to: val });
  closeSheet();
  render();
}

$('board').addEventListener('click', e => {
  const tile = e.target.closest('[data-unit]');
  if (!tile) return;
  openAssignSheet(tile.dataset.unit);
});

/* ---------- add unit ---------- */
/* Two steps in the same sheet: pick a unit (or "type a name" for mutual
   aid), then a one-tap personnel stepper. Never blocks on a number pad. */

$('btn-add-unit').addEventListener('click', () => {
  if (!state) return;
  const { units } = deriveBoard(state.log);
  const onBoardBase = new Set(Object.keys(units).map(n => units[n].splitOf || n));
  const rows = ROSTER.map(r => {
    const already = onBoardBase.has(r.unit);
    const altBlocked = r.altFor && onBoardBase.has(r.altFor);
    const grey = already || altBlocked;
    const note = already ? ' (on board)' : (altBlocked ? ' (' + r.altFor + ' on board)' : '');
    return `<button type="button" class="sheet-opt${grey ? ' grey' : ''}" data-opt="unit-pick" data-value="${escapeHTML(r.unit)}">${escapeHTML(r.unit + note)}</button>`;
  }).join('');
  sheetCtx = { type: 'add-unit' };
  openSheet('Add Unit', `
    ${rows}
    <div class="sheet-group">Mutual aid / other</div>
    <button type="button" class="sheet-opt" data-opt="mutual-aid-pick">Type a unit name…</button>
  `);
});

function renderAddUnitCrewStep(){
  setSheetContent(sheetCtx.name, `
    <div class="clabel" style="text-align:center">Personnel</div>
    <div class="stepper">
      <button type="button" data-step="-1">−</button>
      <span class="sv" id="crew-sv">${sheetCtx.personnel}</span>
      <button type="button" data-step="1">+</button>
    </div>
    <button type="button" class="primary" id="sheet-add-confirm" style="width:100%;margin-top:6px">
      Add ${escapeHTML(sheetCtx.name)}
    </button>
  `);
}

function openMutualAidStep(){
  sheetCtx = { type: 'add-unit-crew', name: '', personnel: 4, mutualAid: true };
  setSheetContent('Mutual Aid Unit', `
    <input type="text" id="ma-name" placeholder="Unit name" autocomplete="off" style="margin-bottom:14px">
    <div class="clabel" style="text-align:center">Personnel</div>
    <div class="stepper">
      <button type="button" data-step="-1">−</button>
      <span class="sv" id="crew-sv">${sheetCtx.personnel}</span>
      <button type="button" data-step="1">+</button>
    </div>
    <button type="button" class="primary" id="sheet-add-confirm" style="width:100%;margin-top:6px">Add Unit</button>
  `);
}

function stepPersonnel(delta){
  if (!sheetCtx || sheetCtx.type !== 'add-unit-crew') return;
  sheetCtx.personnel = Math.max(1, sheetCtx.personnel + delta);
  $('crew-sv').textContent = sheetCtx.personnel;
}

function confirmAddUnit(){
  if (!state || !sheetCtx || sheetCtx.type !== 'add-unit-crew') return;
  let name = sheetCtx.name;
  if (sheetCtx.mutualAid) {
    name = $('ma-name').value.trim();
    if (!name) return;
  }
  appendEntry(state, { t: Date.now(), kind: 'unit-arrive', unit: name, personnel: sheetCtx.personnel });
  closeSheet();
  render();
}

function handleSheetOption(opt, value){
  if (!state) return;
  if (opt === 'role-pick') {
    appendEntry(state, { t: Date.now(), kind: 'role', role: sheetCtx.role, who: value });
    closeSheet(); render(); return;
  }
  if (opt === 'assign-pick') {
    appendEntry(state, { t: Date.now(), kind: 'assign', unit: sheetCtx.unit, to: value });
    closeSheet(); render(); return;
  }
  if (opt === 'split') {
    const { units } = deriveBoard(state.log);
    const u = units[sheetCtx.unit];
    if (!u) { closeSheet(); return; }
    const low = Math.ceil(u.personnel / 2);
    const high = u.personnel - low;
    appendEntry(state, {
      t: Date.now(), kind: 'unit-split', unit: sheetCtx.unit,
      into: [
        { name: sheetCtx.unit + ' — Low Side', personnel: low },
        { name: sheetCtx.unit + ' — High Side', personnel: high }
      ]
    });
    closeSheet(); render(); return;
  }
  if (opt === 'unsplit') {
    appendEntry(state, { t: Date.now(), kind: 'unit-merge', unit: sheetCtx.mergeBase });
    closeSheet(); render(); return;
  }
  if (opt === 'clear-unit') {
    appendEntry(state, { t: Date.now(), kind: 'unit-clear', unit: sheetCtx.unit });
    closeSheet(); render(); return;
  }
  if (opt === 'unit-pick') {
    sheetCtx = { type: 'add-unit-crew', name: value, personnel: defaultCrewFor(value) };
    renderAddUnitCrewStep();
    return;
  }
  if (opt === 'mutual-aid-pick') {
    openMutualAidStep();
    return;
  }
}

$('sheet-body').addEventListener('click', e => {
  const opt = e.target.closest('[data-opt]');
  if (opt) { handleSheetOption(opt.dataset.opt, opt.dataset.value); return; }
  const step = e.target.closest('[data-step]');
  if (step) { stepPersonnel(parseInt(step.dataset.step, 10)); return; }
  if (e.target.id === 'sheet-add-confirm')     { confirmAddUnit(); return; }
  if (e.target.id === 'sheet-role-free-go')    { setRoleFree(); return; }
  if (e.target.id === 'sheet-assign-free-go')  { setAssignFree(); return; }
});

$('sheet-close').addEventListener('click', closeSheet);
$('sheet-backdrop').addEventListener('click', e => {
  if (e.target.id === 'sheet-backdrop') closeSheet();
});

/* ---------- resources ---------- */
/* FMO and CenterPoint don't behave like line companies — no board
   position, just two timestamps each. See the plan. */

function renderResources(){
  const { resources } = deriveBoard(state.log);
  const row = (key, label) => {
    const r = resources[key] || {};
    const reqOn = !!r.requested;
    const sceneOn = !!r.onScene;
    return `
      <div class="resrow">
        <div class="rn">${escapeHTML(label)}</div>
        <div class="restoggles">
          <button type="button" class="${reqOn ? 'on' : ''}" data-res="${key}" data-state="requested" ${reqOn ? 'disabled' : ''}>Requested</button>
          <button type="button" class="${sceneOn ? 'on' : ''}" data-res="${key}" data-state="onScene" ${sceneOn ? 'disabled' : ''}>On Scene</button>
        </div>
      </div>`;
  };
  $('resources').innerHTML = row('fmo', SPECIAL_UNITS.fmo) + row('centerpoint', SPECIAL_UNITS.centerpoint);
}

$('resources').addEventListener('click', e => {
  const btn = e.target.closest('[data-res]');
  if (!btn || btn.disabled || !state) return;
  appendEntry(state, { t: Date.now(), kind: 'resource', which: btn.dataset.res, state: btn.dataset.state });
  render();
});

/* ---------- render ---------- */

const startScreen  = $('start-screen');
const activeScreen = $('active-screen');

function render(){
  if (!state) {
    startScreen.hidden = false;
    activeScreen.hidden = true;
    $('roles-row').innerHTML = '';
    $('board').innerHTML = '';
    $('resources').innerHTML = '';
    closeSheet();
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

  renderRoles();
  renderBoard();
  renderResources();

  const tl = $('timeline');
  if (state.log.length === 0) {
    tl.innerHTML = '<div class="empty">Nothing logged yet.</div>';
  } else {
    // newest first — the thing you just did should be visible without scrolling
    tl.innerHTML = state.log.slice().reverse().map(e =>
      `<li><span class="tm">${fmtTime(e.t)}</span><span class="tx">${escapeHTML(describeEntry(e))}</span></li>`
    ).join('');
  }

  // paint the clocks immediately rather than waiting up to a second for
  // the next interval tick
  tick();
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
  lastChimedParDue = null;

  // Both need a real user gesture to work later; this click is it.
  ensureAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  acquireWakeLock();

  render();
  startTicking();
});

$('btn-par').addEventListener('click', () => {
  if (!state) return;
  appendEntry(state, { t: Date.now(), kind: 'par', result: 'complete' });
  state.parDue = Date.now() + state.parIntervalMin * 60000;
  lastChimedParDue = null;
  saveState(state);
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
  stopTicking();
  releaseWakeLock();
  render();
});

render();
if (state) {
  startTicking();
  acquireWakeLock();
}
