/* Pearland Fire Link — Command module benchmarks and modes
   Edit THIS file to change the prompt checklist, command/operational
   mode options, or the PAR reason list — same pattern as links.js and
   roster.js.

   BENCHMARKS_CORE applies to every occupancy. BENCHMARKS_BY_OCCUPANCY
   entries are ADDED to core, sourced from the deployment bulletin for
   that occupancy (see COMMAND-MODULE-PLAN.md's Source documents table).
   Single Family, Multi-Family, and Strip Mall have no bulletin content
   beyond what CORE already covers, so they get no additions — that's
   deliberate, not an oversight. Add to them only once the SOG actually
   says something occupancy-specific; don't invent one to fill a slot.

   Short action phrases only, not SOG prose — 307 and 401 are
   Lexipol-copyrighted and this is a public site. */

// Short, button-width labels — these are tap targets, not sentences.
// 'accountability' was dropped from this list: the top row's
// Accountability chip already covers it (set once an officer is
// named), so a second "Accountability established" button here was
// redundant with that chip.
const BENCHMARKS_CORE = [
  { key: '360',              label: '360' },
  { key: 'water-supply',     label: 'Water Supply' },
  { key: 'rit',              label: 'RIT' },
  { key: 'under-control',    label: 'Fire Under Control' },
  { key: 'primary-search',   label: 'Primary Search' },
  { key: 'secondary-search', label: 'Secondary Search' },
  { key: 'ventilation',      label: 'Ventilation' }
];

const BENCHMARKS_BY_OCCUPANCY = {
  // TB 25-10: 2½" hose required on commercial fires, Charlie sector
  // truck company, a distinct roof division.
  commercial: [
    { key: 'attack-line-25', label: '2½" attack line deployed' },
    { key: 'charlie-truck',  label: 'Charlie sector truck assigned' },
    { key: 'roof-division',  label: 'Roof division assigned' }
  ],
  // TB 25-12: high-rise (4 stories+) runs its own playbook, not a
  // residential fire with extra floors.
  'high-rise': [
    { key: 'attack-stairwell',  label: 'Attack stairwell identified' },
    { key: 'high-rise-kit',     label: 'High-rise kit staged' },
    { key: 'standpipe',         label: 'Standpipe / FDC connected' },
    { key: 'staging-2-below',   label: 'Staging established — 2 floors below fire' },
    { key: 'lobby-sector',      label: 'Lobby sector established (Squad 1)' },
    { key: 'elevators-secured', label: 'Elevators & control room secured' },
    { key: 'evac-stairwell',    label: 'Evacuation stairwell search complete' }
  ]
};

function benchmarksFor(occupancy){
  return BENCHMARKS_CORE.concat(BENCHMARKS_BY_OCCUPANCY[occupancy] || []);
}

// 401.3's operational-mode declaration. Command mode (Investigative /
// Fast Attack / Command) isn't tracked here — by the time an incident
// needs this module, a dedicated command is already established, so
// declaring it would be logging a fact that's already true rather than
// a live decision.
const OP_MODES = [
  { value: 'offensive', label: 'Offensive' },
  { value: 'defensive', label: 'Defensive' }
];

// 307.3.2(g)1's PAR triggers, reworded as short action phrases rather
// than the SOG's own sentences — see the copyright note above.
const PAR_REASONS = [
  '15 Minutes Elapsed',
  'Mayday',
  'Evacuation',
  'Offensive → Defensive',
  'IC Discretion'
];
