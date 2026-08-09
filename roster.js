/* Pearland Fire Link — Command module roster
   Edit THIS file, not command.js, to change the units on the board —
   same pattern as links.js.

   Order here is station order, not due order. There is no Engine 1 or
   Engine 4 — stations 1 and 4 run ladders — so "1st due engine" in the
   deployment models is a role worked out live from arrival order, never
   read off the unit's door number. See COMMAND-MODULE-PLAN.md.

   defaultCrew is a STARTING POINT for the one-tap personnel stepper when
   adding a unit — not a confirmed staffing number. It comes from how
   many riding positions the deployment SOGs name for that unit TYPE
   (engines/trucks show 5 named positions, medics show 2-3), not from the
   department's actual minimum-staffing chart. Correct it here once
   that's confirmed; the app-side number is always one tap to adjust
   regardless. See "Open Questions" in the plan.

   splits: true means this unit offers the one-tap Split Crew action
   (Low Side / High Side) that every truck company gets in all four
   deployment models. Engines and medics can still be split manually
   from the assign sheet — see the plan — but aren't offered it. */

const ROSTER = [
  { unit: 'Ladder 1',  type: 'truck',  splits: true,  defaultCrew: 4 },
  { unit: 'Medic 1',   type: 'medic',  splits: false, defaultCrew: 2 },
  { unit: 'Engine 2',  type: 'engine', splits: false, defaultCrew: 4 },
  { unit: 'Medic 2',   type: 'medic',  splits: false, defaultCrew: 2 },
  { unit: 'Engine 3',  type: 'engine', splits: false, defaultCrew: 4 },
  { unit: 'Medic 3',   type: 'medic',  splits: false, defaultCrew: 2 },
  { unit: 'Ladder 4',  type: 'truck',  splits: true,  defaultCrew: 4 },
  { unit: 'Medic 4',   type: 'medic',  splits: false, defaultCrew: 2 },
  { unit: 'Engine 5',  type: 'engine', splits: false, defaultCrew: 4 },
  { unit: 'Medic 5',   type: 'medic',  splits: false, defaultCrew: 2 },
  { unit: 'Engine 8',  type: 'engine', splits: false, defaultCrew: 4 },
  { unit: 'Medic 8',   type: 'medic',  splits: false, defaultCrew: 2 },
  // Engine 81 rides in when Tower 8 is down — only one is plausible on
  // an incident at a time. The Add Unit sheet greys out whichever one
  // is already on the board rather than listing both as live options.
  { unit: 'Tower 8',   type: 'truck',  splits: true,  defaultCrew: 4, altFor: 'Engine 81' },
  { unit: 'Engine 81', type: 'engine', splits: false, defaultCrew: 4, altFor: 'Tower 8' },
  { unit: 'Squad 1',   type: 'squad',  splits: false, defaultCrew: 1 }
];

/* Units that don't behave like line companies — never appear in the Add
   Unit sheet, handled by their own controls instead. See the plan. */
const SPECIAL_UNITS = {
  battalion: 'Battalion 1',
  fmo:       'FMO',
  utilities: 'Utilities'
};

/* Positions offered on the assign sheet, grouped for the picker.
   Task assignments and the six-item list come from 401.3 (Secondary
   Search added Aug 8 — it only existed as a Next Considerations
   checklist item before, not an assignable position); sectors and
   staging levels are standard fireground vocabulary; the medic group
   covers the specific jobs 21-03/25-09/25-10/25-12 give 1st-2nd due
   medics. Free text is always available in addition to this list.

   Several items here were shortened Aug 8 ("Initial Fire Attack" ->
   "Fire Attack", "Primary Search & Rescue" -> "Primary Search",
   "Outside Vent (OV)" -> "OV", "EMS / Medical Standby" -> "Medical")
   to match the Assigned Task drag targets in command.js/command.html
   exactly — those are a second way to reach the same positions
   (drag a unit onto a task tile instead of tap unit -> pick from this
   list), and a unit assigned via one path has to land on the same
   position string as the other or the board would fragment into two
   groups for what's really one job. */
const POSITIONS = [
  { group: 'Staging',         items: ['Staging — Level 1', 'Staging — Level 2'] },
  { group: 'Task Assignment', items: ['Scene Safety', 'Fire Attack', 'Primary Search', 'Secondary Search', 'Ventilation', 'RIT', 'Water Supply'] },
  { group: 'Sector',          items: ['Sector A', 'Sector B', 'Sector C', 'Sector D', 'Roof', 'Interior', 'Exposure'] },
  { group: 'Medic',           items: ['OV', 'Utilities', 'Medical', 'Rehab', 'Triage'] }
];
