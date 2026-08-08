/* Pearland Fire Link — Command module
   Phase 1: skeleton and the log.
   Phase 2: elapsed clock, PAR countdown, Wake Lock.
   Phase 3: accountability board, roles, command transfer, resources.
   Phase 4: PAR reasons, command/operational mode, per-occupancy benchmarks.
   Phase 5: deployment-model suggestions on add-unit, by due order.
   Phase 6: plain-text export, copy to clipboard, Web Share.
   Phase 7: undo, save/load hardening, FAQ.
   Reads ROSTER / SPECIAL_UNITS / POSITIONS from roster.js,
   BENCHMARKS_* / OP_MODES / PAR_REASONS from benchmarks.js,
   and SUGGESTIONS / suggestionFor from suggestions.js.

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
//
// loadNotice must ALSO live up here, ahead of `let state = loadState()`
// below: loadState() reads loadNotice, and that call happens the moment
// this line executes — a `let` declared further down would still be in
// its temporal dead zone at that point (this bit twice now; see the
// Phase 3 commit for the first one with `$` itself).
const $ = id => document.getElementById(id);
let loadNotice = null;
let state = loadState();

/* ---------- state ---------- */

function loadState(){
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) {
    loadNotice = 'A saved incident on this device was corrupted and could not be recovered. It has been cleared.';
    try { localStorage.removeItem(STORAGE_KEY); } catch (e2) {}
    return null;
  }
  if (!d || d.v !== SCHEMA_V || !Array.isArray(d.log)) {
    // A future version (or corrupt write) that this code can't read is
    // discarded outright rather than half-loaded. An incident in progress
    // during an app update is an edge case worth this line, not cleverness.
    loadNotice = 'A saved incident from a different version of this page could not be loaded and has been cleared from this device.';
    try { localStorage.removeItem(STORAGE_KEY); } catch (e2) {}
    return null;
  }
  return d;
}

function saveState(d){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    if ($('save-warning')) $('save-warning').innerHTML = '';
  } catch (e) {
    // Storage can fail (private browsing, quota exceeded) — surface it
    // rather than silently losing the action that triggered this save.
    // The in-memory `state` object still has the change; only the next
    // reload is at risk, so this is a warning, not a crash.
    if ($('save-warning')) {
      $('save-warning').innerHTML =
        '<div class="flag urgent"><span>▲</span><span><b>Could not save to this device.</b> ' +
        'Storage may be full or blocked. Keep this tab open, and export often.</span></div>';
    }
  }
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
    // Op mode is NOT stored here — like everything else on the board,
    // it's derived by replaying the log's 'op-mode' entries (see
    // deriveBoard). A mutable field alongside the log is exactly the
    // thing the plan's architecture rule warns against.
    //
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

function modeLabel(list, value){
  const m = list.find(x => x.value === value);
  return m ? m.label : value;
}

function describeEntry(e){
  switch (e.kind) {
    case 'incident-start':
      return 'Incident started' + (e.address ? ' — ' + e.address : '') +
             ' (' + (OCC_LABEL[e.occupancy] || e.occupancy) + ')';
    case 'note':
      return e.text;
    case 'par':
      return 'PAR complete' + (e.reason ? ' — ' + e.reason : '');
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
    case 'unit-recount':
      return e.unit + ' personnel adjusted to ' + e.personnel;
    case 'unit-clear':
      return e.unit + ' cleared from board';
    case 'role':
      return roleLabel(e.role) + ': ' + e.who;
    case 'resource':
      return (SPECIAL_UNITS[e.which] || e.which) + ' ' +
             (e.state === 'onScene' ? 'on scene' : 'requested');
    case 'command-assumed':
      return 'Command transferred';
    case 'op-mode':
      return 'Operational mode: ' + modeLabel(OP_MODES, e.mode);
    case 'benchmark':
      return e.label;
    case 'benchmark-clear':
      return e.label + ' unmarked';
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
  const resources = { fmo: {}, utilities: {} };
  const benchmarksDone = {}; // key -> timestamp completed
  let cmdAssumedAt = null;
  let opMode = null;
  let lastPar = null;
  let lastDefensiveAt = null;
  let lastUnderControlAt = null;

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
      case 'unit-recount':
        if (units[e.unit]) units[e.unit].personnel = e.personnel;
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
      case 'command-assumed':
        cmdAssumedAt = e.t;
        break;
      case 'op-mode':
        opMode = e.mode;
        if (e.mode === 'defensive') lastDefensiveAt = e.t;
        break;
      case 'benchmark':
        benchmarksDone[e.key] = e.t;
        if (e.key === 'under-control') lastUnderControlAt = e.t;
        break;
      case 'benchmark-clear':
        delete benchmarksDone[e.key];
        if (e.key === 'under-control') lastUnderControlAt = null;
        break;
      case 'par':
        lastPar = e.t;
        break;
      default:
        break;
    }
  }

  // A PAR suggestion is "live" if defensive mode or fire-under-control
  // happened more recently than the last completed PAR — once a new PAR
  // logs (for any reason), it naturally stops being suggested. No extra
  // dismiss state needed; this falls straight out of replaying the log.
  let parSuggestion = null;
  if (lastDefensiveAt !== null && (lastPar === null || lastDefensiveAt > lastPar)) {
    parSuggestion = 'Mode changed to defensive';
  } else if (lastUnderControlAt !== null && (lastPar === null || lastUnderControlAt > lastPar)) {
    parSuggestion = 'Fire declared under control';
  }

  return {
    units, splitsOf, roles, resources, benchmarksDone,
    cmdAssumedAt, opMode, parSuggestion
  };
}

function defaultCrewFor(name){
  const r = ROSTER.find(x => x.unit === name);
  return r ? r.defaultCrew : 4;
}

/* Abbreviation is derived from the roster name itself (first letter +
   number, e.g. "Ladder 1" -> "L1") rather than a separate lookup table
   — one source of truth, and it stays correct automatically if roster.js
   changes. Used for the small square tiles in the Add Unit sheet. */
function unitAbbrev(name){
  const m = name.match(/^(\S)\S*\s+(\d+)/);
  return m ? (m[1].toUpperCase() + m[2]) : name;
}
function unitNumber(name){
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/* Grouping for the Add Unit sheet: Ladder and Tower share roster type
   'truck' (see roster.js) and are shown together since they fill the
   same role on the board; Squad gets its own group since it's neither. */
const ADD_UNIT_GROUPS = [
  { label: 'Engines',          type: 'engine' },
  { label: 'Medics',           type: 'medic' },
  { label: 'Ladders / Towers', type: 'truck' },
  { label: 'Squad',            type: 'squad' }
];

function fmtTime(t){
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(t){
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

  const elapsed = Date.now() - state.startedAt;
  const hdrElapsed = $('hdr-elapsed');
  if (hdrElapsed) hdrElapsed.textContent = fmtHMS(elapsed);

  updateParTimer();
}

/* Same markup whether or not PAR is actually overdue — only
   visibility (not display) changes, so the banner's box always
   occupies its slot and nothing below it shifts when it turns on. */
function parOverdueFlagHTML(mins){
  const hidden = mins === null;
  const line2 = hidden
    ? '0 minutes ago.'
    : (mins < 1 ? 'Less than a minute' : mins + ' minute' + (mins === 1 ? '' : 's')) + ' ago.';
  return '<div class="par-due-box' + (hidden ? ' par-due-box--hidden' : '') + '"' +
    (hidden ? ' aria-hidden="true"' : '') +
    '><span>▲</span><span class="par-due-text"><b class="par-overdue-label">PAR OVERDUE.</b>' +
    '<span class="par-due-line2">' + line2 + '</span></span><span>▲</span></div>';
}

function updateParTimer(){
  if (!state) return;
  const parBtn = $('btn-par-timer');
  const banner = $('par-banner');

  if (!state.parDue) {
    if (parBtn) parBtn.textContent = 'PAR: OFF';
    if (parBtn) parBtn.style.setProperty('--par-color', 'var(--faint)');
    banner.innerHTML = parOverdueFlagHTML(null);
    return;
  }

  const remain = state.parDue - Date.now();

  // Color-code based on time remaining: 4 stages
  // 10+ min remaining: white (fresh)
  // 5-10 min remaining: amber (starting to warn)
  // 0-5 min remaining: orange (stronger warning)
  // Overdue: red
  let bgColor;
  if (remain > 10 * 60000) {
    bgColor = 'var(--txt)';
  } else if (remain > 5 * 60000) {
    bgColor = 'var(--amber)';
  } else if (remain > 0) {
    bgColor = '#d98b2c'; // orange
  } else {
    bgColor = 'var(--red)';
  }

  if (parBtn) {
    parBtn.style.setProperty('--par-color', bgColor);
    if (remain > 0) {
      parBtn.textContent = 'PAR: ' + fmtMS(remain);
    } else {
      const overMs = -remain;
      parBtn.textContent = 'PAR: ' + fmtMS(overMs);
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

  if (remain > 0) {
    banner.innerHTML = parOverdueFlagHTML(null);
  } else {
    const overMs = -remain;
    const mins = Math.floor(overMs / 60000);
    banner.innerHTML = parOverdueFlagHTML(mins);
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

/* ---------- top chip row: command transfer, op mode, roles ---------- */
/* One row. Cmd Transferred is a bare timestamp marker, not a "who's in
   command" display — whoever is running this module IS command, so
   there's nothing to name. Ops Mode is 401.3's offensive/defensive
   declaration; a change to defensive is what drives the PAR suggestion
   below. Safety/Accountability are pinned here rather than assigned
   like a division because 307.3.2(a)1 makes the IC directly
   responsible for them. */

function renderTopChips(){
  const { roles, cmdAssumedAt, opMode } = deriveBoard(state.log);
  $('topchips-row').innerHTML = `
    <button type="button" class="rolechip${cmdAssumedAt ? ' set' : ''}" data-role-chip="cmd-assumed">
      <span class="rl">Cmd Transferred</span><span class="rv">${cmdAssumedAt ? fmtTime(cmdAssumedAt) : 'Tap to mark'}</span>
    </button>
    <button type="button" class="rolechip${opMode ? ' set' : ''}" data-mode-chip="op-mode">
      <span class="rl">Ops Mode</span><span class="rv">${escapeHTML(opMode ? modeLabel(OP_MODES, opMode) : 'Not set')}</span>
    </button>
    <button type="button" class="rolechip${roles.safety ? ' set' : ''}" data-role-chip="safety">
      <span class="rl">Safety</span><span class="rv">${escapeHTML(roles.safety || 'Not set')}</span>
    </button>
    <button type="button" class="rolechip${roles.accountability ? ' set' : ''}" data-role-chip="accountability">
      <span class="rl">Accountability</span><span class="rv">${escapeHTML(roles.accountability || 'Not set')}</span>
    </button>
  `;
}

function openModeSheet(){
  sheetCtx = { type: 'mode', kind: 'op-mode' };
  openSheet('Operational Mode', OP_MODES.map(m =>
    `<button type="button" class="sheet-opt" data-opt="mode-pick" data-value="${escapeHTML(m.value)}">${escapeHTML(m.label)}</button>`
  ).join(''));
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

$('topchips-row').addEventListener('click', e => {
  const modeChip = e.target.closest('[data-mode-chip]');
  if (modeChip && state) { openModeSheet(); return; }

  const roleChip = e.target.closest('[data-role-chip]');
  if (!roleChip || !state) return;
  const kind = roleChip.dataset.roleChip;
  if (kind === 'cmd-assumed') {
    // Re-tappable, on purpose — command can transfer more than once
    // in an incident (initial officer, then an arriving BC), and this
    // button only marks the moment, not who holds it.
    appendEntry(state, { t: Date.now(), kind: 'command-assumed' });
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

function openAssignSheet(unitName, suggestion){
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

  // A suggestion only ever appears once, at the moment a unit is added
  // (see confirmAddUnit) — never re-shown on later reassignment, since
  // by then reality has usually already diverged from the model. It's
  // one more option in this same sheet, not a separate flow, per the
  // plan: "a one-tap default sitting next to the full picker."
  let suggestBlock = '';
  if (suggestion) {
    suggestBlock = `
    <div class="sheet-group">Suggested</div>
    <button type="button" class="sheet-opt suggested" data-opt="assign-pick" data-value="${escapeHTML(suggestion)}">${escapeHTML(suggestion)}</button>`;
  }

  const groups = POSITIONS.map(g => `
    <div class="sheet-group">${escapeHTML(g.group)}</div>
    ${g.items.map(p =>
      `<button type="button" class="sheet-opt" data-opt="assign-pick" data-value="${escapeHTML(p)}">${escapeHTML(p)}</button>`
    ).join('')}
  `).join('');

  openSheet(unitName + ' (' + u.personnel + ')', `
    ${suggestBlock}
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

/* Short tap opens the assign sheet (unchanged). A long press (550ms,
   cancelled by releasing early or dragging) opens the personnel
   re-count sheet instead — see openUnitRecountSheet. suppressNextClick
   stops the click that still fires on release from also opening the
   assign sheet right after the long-press already opened something. */
let boardLongPressTimer = null;
let boardLongPressUnit = null;
let boardPressStart = null;
let boardSuppressClick = false;

$('board').addEventListener('pointerdown', e => {
  const tile = e.target.closest('[data-unit]');
  if (!tile) return;
  boardLongPressUnit = tile.dataset.unit;
  boardPressStart = { x: e.clientX, y: e.clientY };
  boardSuppressClick = false;
  clearTimeout(boardLongPressTimer);
  boardLongPressTimer = setTimeout(() => {
    boardSuppressClick = true;
    openUnitRecountSheet(boardLongPressUnit);
  }, 550);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(evt =>
  $('board').addEventListener(evt, () => clearTimeout(boardLongPressTimer))
);
$('board').addEventListener('pointermove', e => {
  if (!boardPressStart) return;
  if (Math.hypot(e.clientX - boardPressStart.x, e.clientY - boardPressStart.y) > 10) {
    clearTimeout(boardLongPressTimer);
  }
});
$('board').addEventListener('click', e => {
  if (boardSuppressClick) { boardSuppressClick = false; return; }
  const tile = e.target.closest('[data-unit]');
  if (!tile) return;
  openAssignSheet(tile.dataset.unit);
});

/* ---------- add unit ---------- */
/* Small square tiles, grouped and sorted numerically within each
   group. Tap to select/deselect any number of them, then one batch
   "Add" appends all of them at once at their roster default crew —
   no per-unit stepper detour, and no auto-flow into the assign sheet
   afterward (that only makes sense one unit at a time, and would mean
   a chain of sheets for a multi-unit add). Reposition/split/clear
   still happens by tapping the tile on the board afterward — unchanged.
   Mutual aid stays its own one-at-a-time flow below, since it needs a
   typed name and has no roster default. */

$('btn-add-unit').addEventListener('click', () => {
  if (!state) return;
  sheetCtx = { type: 'add-unit-batch', selected: new Set() };
  renderAddUnitBatchSheet();
});

function renderAddUnitBatchSheet(){
  const { units } = deriveBoard(state.log);
  const onBoardBase = new Set(Object.keys(units).map(n => units[n].splitOf || n));
  const groupsHTML = ADD_UNIT_GROUPS.map(g => {
    const entries = ROSTER.filter(r => r.type === g.type)
      .slice().sort((a, b) => unitNumber(a.unit) - unitNumber(b.unit));
    if (!entries.length) return '';
    const tiles = entries.map(r => {
      const already = onBoardBase.has(r.unit);
      const altBlocked = r.altFor && onBoardBase.has(r.altFor);
      const disabled = already || altBlocked;
      const selected = sheetCtx.selected.has(r.unit);
      return `<button type="button" class="unit-pick-tile${selected ? ' selected' : ''}${disabled ? ' grey' : ''}"
        data-unit-toggle="${escapeHTML(r.unit)}" ${disabled ? 'disabled' : ''}
        aria-label="${escapeHTML(r.unit)}">${escapeHTML(unitAbbrev(r.unit))}</button>`;
    }).join('');
    return `<div class="sheet-group">${escapeHTML(g.label)}</div><div class="unit-pick-row">${tiles}</div>`;
  }).join('');

  const n = sheetCtx.selected.size;
  openSheet('Add Units', `
    ${groupsHTML}
    <div class="sheet-group">Mutual aid / other</div>
    <button type="button" class="sheet-opt" data-opt="mutual-aid-pick">Type a unit name…</button>
    <button type="button" class="primary" id="sheet-add-batch-confirm" style="width:100%;margin-top:14px" ${n ? '' : 'disabled'}>
      Add ${n ? n + ' Unit' + (n === 1 ? '' : 's') : 'Units'}
    </button>
  `);
}

function toggleUnitPick(name){
  if (!sheetCtx || sheetCtx.type !== 'add-unit-batch') return;
  if (sheetCtx.selected.has(name)) sheetCtx.selected.delete(name);
  else sheetCtx.selected.add(name);
  renderAddUnitBatchSheet();
}

function confirmAddUnitBatch(){
  if (!state || !sheetCtx || sheetCtx.type !== 'add-unit-batch') return;
  const selected = [...sheetCtx.selected];
  if (!selected.length) return;
  selected.forEach(name => {
    appendEntry(state, { t: Date.now(), kind: 'unit-arrive', unit: name, personnel: defaultCrewFor(name) });
  });
  closeSheet();
  render();
}

/* ---------- adjust personnel (long-press an on-board unit) ---------- */

function openUnitRecountSheet(unitName){
  const { units } = deriveBoard(state.log);
  const u = units[unitName];
  if (!u) return;
  sheetCtx = { type: 'unit-recount', unit: unitName, personnel: u.personnel };
  openSheet('Adjust Personnel', `
    <div class="clabel" style="text-align:center">${escapeHTML(unitName)}</div>
    <div class="stepper">
      <button type="button" data-step="-1">−</button>
      <span class="sv" id="crew-sv">${sheetCtx.personnel}</span>
      <button type="button" data-step="1">+</button>
    </div>
    <button type="button" class="primary" id="sheet-recount-confirm" style="width:100%;margin-top:6px">Save</button>
  `);
}

function confirmUnitRecount(){
  if (!state || !sheetCtx || sheetCtx.type !== 'unit-recount') return;
  appendEntry(state, { t: Date.now(), kind: 'unit-recount', unit: sheetCtx.unit, personnel: sheetCtx.personnel });
  closeSheet();
  render();
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
  if (!sheetCtx || (sheetCtx.type !== 'add-unit-crew' && sheetCtx.type !== 'unit-recount')) return;
  sheetCtx.personnel = Math.max(1, sheetCtx.personnel + delta);
  $('crew-sv').textContent = sheetCtx.personnel;
}

// Which Nth unit of this TYPE has arrived so far — always from arrival
// order in the log, never from the unit's door number (there is no
// Engine 1 or Engine 4; see roster.js). Mutual aid units carry no
// roster type and don't participate in due-order counting.
function dueIndexForType(type, log){
  let count = 0;
  for (const e of log) {
    if (e.kind !== 'unit-arrive') continue;
    const r = ROSTER.find(x => x.unit === e.unit);
    if (r && r.type === type) count++;
  }
  return count + 1;
}

function confirmAddUnit(){
  if (!state || !sheetCtx || sheetCtx.type !== 'add-unit-crew') return;
  let name = sheetCtx.name;
  if (sheetCtx.mutualAid) {
    name = $('ma-name').value.trim();
    if (!name) return;
  }

  const rosterEntry = ROSTER.find(r => r.unit === name);
  let suggestion = null;
  if (rosterEntry) {
    const dueIndex = dueIndexForType(rosterEntry.type, state.log);
    suggestion = suggestionFor(state.occupancy, rosterEntry.type, dueIndex);
  }

  appendEntry(state, { t: Date.now(), kind: 'unit-arrive', unit: name, personnel: sheetCtx.personnel });
  render();

  // Suggestion or not, the natural next question after adding a unit
  // is "where does it go" — flow straight into the assign sheet rather
  // than closing. Dismissing it (✕ or backdrop tap) costs nothing;
  // the unit just sits in Staging.
  openAssignSheet(name, suggestion);
}

function handleSheetOption(opt, value){
  if (!state) return;
  if (opt === 'role-pick') {
    appendEntry(state, { t: Date.now(), kind: 'role', role: sheetCtx.role, who: value });
    closeSheet(); render(); return;
  }
  if (opt === 'mode-pick') {
    appendEntry(state, { t: Date.now(), kind: sheetCtx.kind, mode: value });
    closeSheet(); render(); return;
  }
  if (opt === 'par-reason') {
    appendEntry(state, { t: Date.now(), kind: 'par', reason: value, result: 'complete' });
    state.parDue = Date.now() + state.parIntervalMin * 60000;
    lastChimedParDue = null;
    saveState(state);
    closeSheet(); render(); return;
  }
  if (opt === 'par-stop') {
    state.parDue = null;
    lastChimedParDue = null;
    saveState(state);
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
  if (opt === 'mutual-aid-pick') {
    openMutualAidStep();
    return;
  }
}

$('sheet-body').addEventListener('click', e => {
  const opt = e.target.closest('[data-opt]');
  if (opt) { handleSheetOption(opt.dataset.opt, opt.dataset.value); return; }
  const toggle = e.target.closest('[data-unit-toggle]');
  if (toggle && !toggle.disabled) { toggleUnitPick(toggle.dataset.unitToggle); return; }
  const step = e.target.closest('[data-step]');
  if (step) { stepPersonnel(parseInt(step.dataset.step, 10)); return; }
  if (e.target.id === 'sheet-add-confirm')        { confirmAddUnit(); return; }
  if (e.target.id === 'sheet-add-batch-confirm')  { confirmAddUnitBatch(); return; }
  if (e.target.id === 'sheet-recount-confirm')    { confirmUnitRecount(); return; }
  if (e.target.id === 'sheet-role-free-go')       { setRoleFree(); return; }
  if (e.target.id === 'sheet-assign-free-go')     { setAssignFree(); return; }
});

$('sheet-close').addEventListener('click', closeSheet);
$('sheet-backdrop').addEventListener('click', e => {
  if (e.target.id === 'sheet-backdrop') closeSheet();
});

/* ---------- resources ---------- */
/* FMO and Utilities don't behave like line companies — no board
   position, just two timestamps each. See the plan. Shown as two equal
   columns in one row rather than stacked full-width rows — there are
   only ever these two, so there's no reason to spend the vertical
   space stacking gains nothing. */

function renderResources(){
  const { resources } = deriveBoard(state.log);
  const col = (key, label) => {
    const r = resources[key] || {};
    const reqOn = !!r.requested;
    const sceneOn = !!r.onScene;
    return `
      <div class="rescol">
        <div class="rn">${escapeHTML(label)}</div>
        <div class="restoggles">
          <button type="button" class="${reqOn ? 'on' : ''}" data-res="${key}" data-state="requested" ${reqOn ? 'disabled' : ''}>Requested</button>
          <button type="button" class="${sceneOn ? 'on' : ''}" data-res="${key}" data-state="onScene" ${sceneOn ? 'disabled' : ''}>On Scene</button>
        </div>
      </div>`;
  };
  $('resources').innerHTML = col('fmo', SPECIAL_UNITS.fmo) + col('utilities', SPECIAL_UNITS.utilities);
}

$('resources').addEventListener('click', e => {
  const btn = e.target.closest('[data-res]');
  if (!btn || btn.disabled || !state) return;
  appendEntry(state, { t: Date.now(), kind: 'resource', which: btn.dataset.res, state: btn.dataset.state });
  render();
});

/* ---------- next considerations (401.3, per occupancy) ---------- */
/* A toggle, not a one-way mark: tapping logs it done; tapping again
   logs 'benchmark-clear' and reopens it. Both directions are real,
   timestamped log entries — this is for "that was a mistake, it
   isn't actually done," a genuine correction worth recording, not the
   same thing Phase 7's undo-last-action covers (removing the last
   action outright). The label never changes to "Complete" — with
   several buttons done at once, you need the original name still
   readable to pick the right one to un-tap; a small status line under
   it carries the done state instead. */

function renderChecklist(){
  const { benchmarksDone } = deriveBoard(state.log);
  const items = benchmarksFor(state.occupancy);
  $('checklist').innerHTML = items.map(b => {
    const done = !!benchmarksDone[b.key];
    return `<button type="button" class="ck-item${done ? ' done' : ''}" data-benchmark="${escapeHTML(b.key)}"
      data-label="${escapeHTML(b.label)}">
      <span class="lb">${escapeHTML(b.label)}</span>
      ${done ? '<span class="status">Complete</span>' : ''}
    </button>`;
  }).join('');
}

$('checklist').addEventListener('click', e => {
  const btn = e.target.closest('[data-benchmark]');
  if (!btn || !state) return;
  const key = btn.dataset.benchmark;
  const { benchmarksDone } = deriveBoard(state.log);
  const kind = benchmarksDone[key] ? 'benchmark-clear' : 'benchmark';
  appendEntry(state, { t: Date.now(), kind, key, label: btn.dataset.label });
  render();
});

/* ---------- PAR suggestion ---------- */
/* Never a forced modal — see the plan. Just a dismissible-by-nature
   box that stops showing once any PAR logs, computed fresh from the
   log by deriveBoard rather than tracked as separate UI state. Always
   rendered, same reserved-space trick as the PAR due box next to it —
   visibility toggles, not display, so the row next to PAR due doesn't
   shift depending on whether there's a suggestion right now. */

function renderParSuggestion(){
  const { parSuggestion } = deriveBoard(state.log);
  const hidden = !parSuggestion;
  const text = parSuggestion || 'placeholder';
  $('par-suggestion').innerHTML =
    '<div class="par-suggest-box' + (hidden ? ' par-suggest-box--hidden' : '') + '"' +
    (hidden ? ' aria-hidden="true"' : '') +
    '><b>Consider PAR.</b><span class="par-suggest-line2">' + escapeHTML(text) + '.</span></div>';
}

/* ---------- export ---------- */
/* The timeline already exists; export is a formatter over it, per the
   plan's architectural rule — nothing here is computed any other way
   than by replaying the same log everything else replays.

   PAR entries get an inline unit manifest (unit, personnel, position)
   snapshotted from the board AS OF that exact log index — this is what
   307.3.2(g)3 asks a PAR report to contain, and it "comes free from
   the board" exactly the way the plan says it should: replay the log
   up to that point and read off deriveBoard's units. */

function modeSequence(kind, list){
  const seq = [];
  state.log.forEach(e => {
    if (e.kind === kind && (seq.length === 0 || seq[seq.length - 1] !== e.mode)) {
      seq.push(e.mode);
    }
  });
  return seq.map(v => modeLabel(list, v));
}

function exportText(){
  const lines = [];
  const occLabel = OCC_LABEL[state.occupancy] || state.occupancy;
  lines.push('INCIDENT — ' + occLabel + (state.address ? ' — ' + state.address : ''));

  const endEntry = state.log.find(e => e.kind === 'incident-end');
  const endedAt = endEntry ? endEntry.t : Date.now();
  lines.push('Started ' + fmtDate(state.startedAt) + ' ' + fmtTime(state.startedAt) +
             '  ·  Duration ' + fmtHMS(endedAt - state.startedAt));

  const opSeq = modeSequence('op-mode', OP_MODES);
  if (opSeq.length) lines.push('Mode: ' + opSeq.join(' → '));

  lines.push('');

  state.log.forEach((e, i) => {
    lines.push(fmtTime(e.t) + '  ' + describeEntry(e));
    if (e.kind === 'par') {
      const snap = deriveBoard(state.log.slice(0, i + 1));
      const names = Object.keys(snap.units);
      if (names.length === 0) {
        lines.push('    (no units on board)');
      } else {
        names.forEach(n => {
          const u = snap.units[n];
          lines.push('    ' + n + '  (' + u.personnel + ')  ' + u.position);
        });
      }
    }
  });

  return lines.join('\n');
}

function renderExport(){
  $('export-text').value = exportText();
}

function flashExportStatus(msg){
  const el = $('export-status');
  el.textContent = msg;
  clearTimeout(flashExportStatus._t);
  flashExportStatus._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

$('btn-copy').addEventListener('click', async () => {
  const text = $('export-text').value;
  try {
    await navigator.clipboard.writeText(text);
    flashExportStatus('Copied to clipboard.');
  } catch (e) {
    // Clipboard API can be unavailable (older WebView, non-secure
    // context); fall back to the old select-and-execCommand trick
    // rather than leaving the tap looking like it did nothing.
    const ta = $('export-text');
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      flashExportStatus('Copied to clipboard.');
    } catch (e2) {
      flashExportStatus('Could not copy — select the text above manually.');
    }
  }
});

if (navigator.share) {
  $('btn-share').hidden = false;
  $('btn-share').addEventListener('click', () => {
    navigator.share({ text: $('export-text').value }).catch(() => {
      // user cancelled the share sheet — not an error worth surfacing
    });
  });
}

/* ---------- render ---------- */

const startScreen  = $('start-screen');
const activeScreen = $('active-screen');

function render(){
  if (!state) {
    startScreen.hidden = false;
    activeScreen.hidden = true;
    $('topchips-row').innerHTML = '';
    $('board').innerHTML = '';
    $('resources').innerHTML = '';
    $('checklist').innerHTML = '';
    $('par-suggestion').innerHTML = '';
    $('export-text').value = '';
    $('save-warning').innerHTML = '';
    $('btn-undo').hidden = true;
    $('undo-caption').textContent = '';
    if (loadNotice) {
      $('load-notice').innerHTML =
        '<div class="flag"><span>▲</span><span>' + escapeHTML(loadNotice) + '</span></div>';
    }
    closeSheet();
    return;
  }
  startScreen.hidden = true;
  activeScreen.hidden = false;

  const hdrOcc = $('hdr-occ');
  if (hdrOcc) hdrOcc.textContent = OCC_LABEL[state.occupancy] || state.occupancy;

  renderTopChips();
  renderBoard();
  renderResources();
  renderChecklist();
  renderParSuggestion();
  renderExport();
  renderUndo();

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

/* ---------- undo ---------- */
/* The plan's stand-in for confirmation dialogs on the critical path:
   "No confirmation dialogs on the critical path — undo instead." One
   entry at a time, oldest bound at incident-start (an incident always
   needs at least that one entry to exist). */

// Reconstructs parDue as if the last PAR never happened — anchored to
// whichever PAR is now last in the log (or incident start if none),
// exactly like a real PAR reset is anchored to "now" at completion
// time. Safe to call after ANY undo, not just a PAR one: if the entry
// removed wasn't a PAR, the last PAR timestamp in the log is unchanged
// and this recomputes the same value that was already there.
function recomputeParDue(){
  let lastParAt = null;
  state.log.forEach(e => { if (e.kind === 'par') lastParAt = e.t; });
  state.parDue = (lastParAt !== null ? lastParAt : state.startedAt) + state.parIntervalMin * 60000;
  lastChimedParDue = null;
}

function renderUndo(){
  const btn = $('btn-undo');
  const caption = $('undo-caption');
  // log[0] is always incident-start — never undoable, an incident needs it.
  if (state.log.length <= 1) {
    btn.hidden = true;
    caption.textContent = '';
    return;
  }
  const last = state.log[state.log.length - 1];
  btn.hidden = false;
  caption.textContent = 'Will undo: ' + describeEntry(last);
}

$('btn-undo').addEventListener('click', () => {
  if (!state || state.log.length <= 1) return;
  state.log.pop();
  recomputeParDue();
  saveState(state);
  render();
});

/* ---------- PAR timer button (in header) ---------- */

$('btn-par-timer').addEventListener('click', () => {
  if (!state) return;

  // PAR is off: this tap's job is just to get it running again, not to
  // ask for a reason first — the same one-tap-to-restart the button's
  // label ("PAR: OFF") implies.
  if (!state.parDue) {
    state.parDue = Date.now() + state.parIntervalMin * 60000;
    lastChimedParDue = null;
    saveState(state);
    render();
    return;
  }

  sheetCtx = { type: 'par' };
  // 307.3.2(g)1's trigger list — picking a reason is the same tap that
  // completes the PAR and resets the clock (handleSheetOption's
  // 'par-reason' case). "Stop" is separate: it disables the countdown
  // entirely without logging a completed PAR, for when the IC is done
  // needing 15-minute accountability checks.
  const html = PAR_REASONS.map(r =>
    `<button type="button" class="sheet-opt" data-opt="par-reason" data-value="${escapeHTML(r)}">${escapeHTML(r)}</button>`
  ).join('') +
    `<div class="sheet-group">Other</div>
     <button type="button" class="sheet-opt destructive" data-opt="par-stop" data-value="">
       Stop PAR Timer
     </button>`;
  openSheet('PAR — Reason', html);
});

/* ---------- FAQ ---------- */

const FAQ_HTML = `
  <p><b>What is this?</b><br>An incident scratchpad for the IC's own phone or tablet.
  It tracks units, positions, and a timeline while you work an incident, and formats
  it into text you can paste into a report afterward.</p>
  <p><b>Is it official?</b><br>No. It's not a Pearland Fire Department system, and
  nothing here overrides the department's own SOGs. Suggested assignments are drawn
  from the department's own deployment training bulletins, but they're suggestions
  only — one tap to accept, or ignore them and pick anything else. Nothing is ever
  assigned automatically.</p>
  <p><b>Does it sync anywhere?</b><br>No. No backend, no login, no other device sees
  this. Everything lives only in this browser's storage on this device.</p>
  <p><b>What happens to the data?</b><br>Ending an incident clears it from this
  device for good. Export the timeline first if you want to keep it — see the
  Export card near the bottom of an active incident.</p>
  <p><b>Will it alert me if a PAR is overdue?</b><br>The countdown is always correct
  the moment you look at the screen, even after the phone was locked. But a sound or
  notification while the screen is off is <b>not guaranteed</b> — iOS in particular
  can silently block background audio for a locked web app. Don't rely on hearing a
  chime; rely on checking the screen.</p>
  <p><b>What if this page updates while I have an incident open?</b><br>If a future
  version can't read an older saved incident, it's discarded outright rather than
  half-loaded, and you'll see a plain notice about it on the start screen.</p>
`;

$('btn-faq').addEventListener('click', () => {
  sheetCtx = { type: 'faq' };
  openSheet('About Command', FAQ_HTML);
});

/* ---------- back to index (screen flip) ---------- */
$('btn-back').addEventListener('click', e => {
  e.preventDefault();
  const url = e.currentTarget.href;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { location.href = url; return; }
  sessionStorage.setItem('pfd-flip-return', '1');
  document.body.classList.add('flip-out');
  // animationend won't fire if the tab is backgrounded or the compositor
  // stalls mid-tap — see index.html's matching handler for why this
  // always has a timer backing it up.
  let navigated = false;
  const go = () => { if (navigated) return; navigated = true; location.href = url; };
  document.body.addEventListener('animationend', function once(ev){
    if (ev.animationName === 'pflipOut') { document.body.removeEventListener('animationend', once); go(); }
  });
  setTimeout(go, 400);
});

/* ---------- actions ---------- */

$('btn-start').addEventListener('click', () => {
  const occ  = $('f-occ').value;
  const addr = $('f-addr').value.trim();
  state = newIncident(occ, addr);
  saveState(state);
  $('f-addr').value = '';
  lastChimedParDue = null;
  loadNotice = null; // stale on a second start within the same page session
  $('load-notice').innerHTML = '';

  // Both need a real user gesture to work later; this click is it.
  ensureAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  acquireWakeLock();

  render();
  startTicking();
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
