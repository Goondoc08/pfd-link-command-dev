/* Pearland Fire Link — Command module deployment-model suggestions
   Edit THIS file to change what gets suggested when a unit is added —
   same pattern as links.js, roster.js, benchmarks.js.

   A suggestion is a ONE-TAP DEFAULT sitting next to the full position
   picker, never an automatic placement — see COMMAND-MODULE-PLAN.md.
   Ignoring one costs nothing.

   Sourced from each occupancy's deployment training bulletin's
   narrative section ("1st Due Engine • Quick 360 if able • ..."),
   condensed to the SAME short phrases used elsewhere in this app
   (POSITIONS in roster.js, benchmark labels in benchmarks.js) wherever
   the bulletin's job matches one of those exactly, and a short
   paraphrase otherwise. The riding-position tables (Officer / Nozzle /
   Backup / Control / D-O) are out of scope — see the plan's "Deferred,
   deliberately" section.

   Keyed by occupancy -> unit TYPE (engine | truck | medic | squad) ->
   due-order index (1-based, position in the array). A due-order index
   is which Nth unit of that type arrived, worked out live from arrival
   order in command.js — never from the unit's door number, since there
   is no Engine 1 or Engine 4 (see roster.js). Past the end of an array
   the bulletin itself says "IC tasked" / "task given by IC" for that
   slot, which isn't a specific suggestion this module should invent.

   Single Family (21-03), Multi-Family (25-09), Commercial/Big-Box
   (25-10), and High Rise (25-12) each have a dedicated bulletin with
   this narrative section. Strip Mall only appears as a column inside
   the other four bulletins' detail tables and reads as functionally
   identical to Multi-Family/Commercial there — no narrative section of
   its own — so it gets no suggestion table rather than an invented one.
   Same for "other": no table means no suggestions, which is exactly
   the plan's stated behavior for occupancy "Other". */

const SUGGESTIONS = {
  'single-family': {
    // 21-03 narrative
    engine: ['Initial Fire Attack', 'Water Supply', 'RIT'],
    truck:  ['Primary Search & Rescue', 'Secondary Search'],
    medic:  ['Outside Vent (OV)', 'EMS / Medical Standby']
  },
  'multi-family': {
    // 25-09 narrative
    engine: ['Initial Fire Attack', 'Water Supply', 'RIT', 'Secondary Water Supply'],
    truck:  ['Primary Search & Rescue', 'Secondary Search', 'Overhaul'],
    medic:  ['Outside Vent (OV)', 'Outside Vent (OV)', 'EMS / Medical Standby']
  },
  commercial: {
    // 25-10 narrative — 2½" hose required, Charlie sector truck, roof division
    engine: ['Initial Fire Attack', 'Water Supply', 'RIT', 'Secondary Water Supply', 'Fire Attack (assist)'],
    truck:  ['Roof', 'Sector C', 'Primary Search & Rescue', 'Ventilation'],
    medic:  ['Outside Vent (OV)', 'EMS / Medical Standby', 'EMS / Medical Standby']
  },
  'high-rise': {
    // 25-12 narrative — 4 stories and up, its own playbook
    engine: ['Initial Fire Attack', 'Fire Attack (assist)', 'Secondary Water Supply',
             'Staging — 2 Floors Below Fire', 'Staging — 2 Floors Below Fire'],
    truck:  ['Primary Search & Rescue', 'Primary Search & Rescue', 'Ventilation',
             'Staging — 2 Floors Below Fire', 'Staging — 2 Floors Below Fire'],
    medic:  ['Elevators & Control Room', 'Evacuation Stairwell', 'EMS / Medical Standby', 'Triage'],
    // Squad 1 isn't due-order tracked — there's only ever one, and 25-12
    // gives it a fixed job: "assume the Lobby sector on arrival."
    squad:  ['Lobby Sector']
  }
};

function suggestionFor(occupancy, type, dueIndex){
  const table = SUGGESTIONS[occupancy];
  if (!table || !table[type]) return null;
  return table[type][dueIndex - 1] || null;
}
