/* Pearland Fire Link — Command module
   Phase 1: skeleton and the log.
   Phase 2: elapsed clock, PAR countdown, Wake Lock.

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

function describeEntry(e){
  switch (e.kind) {
    case 'incident-start':
      return 'Incident started' + (e.address ? ' — ' + e.address : '') +
             ' (' + (OCC_LABEL[e.occupancy] || e.occupancy) + ')';
    case 'note':
      return e.text;
    case 'par':
      return 'PAR complete';
    case 'incident-end':
      return 'Incident ended';
    default:
      return e.kind;
  }
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
