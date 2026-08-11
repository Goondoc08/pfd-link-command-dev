/* ============================================================
   STATION DUTIES — shared by duties.html and index.html
   (index.html's desktop chore-of-the-day teaser reads this too, so
   it's a shared data file rather than living inline in duties.html —
   same pattern as shift.js/mando.js.)
   ============================================================ */

function apparatusText(){
  return "Check fluids on all units and tools, refill and replace as needed. Inspect and clean "
       + "engine and pump areas as well as all compartments. Perform a full function test on every "
       + "piece of mechanical and motorized tool. Clean and inspect patient areas for all necessary "
       + "equipment and state compliance requirements. Clean all SCBA regulators with cleaning "
       + "solution. Report all issues properly.";
}

const DUTIES = {
  1: { title:"Kitchen / Dayroom",
       body:"Kitchen cleaning includes refrigerators, ovens, grease traps, and wiping cabinets. "
          + "Wipe down all dayroom furniture including dusting and disinfecting. "
          + "Sweep and mop underneath moveable furniture." },
  2: { title:"Apparatus Day — Primary / Frontline", body: apparatusText() },
  3: { title:"Office / Dorms",
       body:"Dusting and disinfecting of furniture in office and dorms including fans and closets. "
          + "Sweep and mop underneath moveable furniture. Organize cabinets/shelves and counters.",
       extra:{ head:"Day 1 — Cycle Count",
               text:"Wednesdays that occur on day 1 of the tour are held for cycle count — EMS "
                  + "supplies and station supplies. All inventory must be counted and documented properly." } },
  4: { title:"Apparatus Day — Secondary and Reserve", body: apparatusText() },
  5: { title:"Bathrooms / Laundry / Weightroom",
       body:"Bathroom cleaning includes scrubbing showers. Disinfect all weight equipment. "
          + "Clean mirrors and windows. Sweep and mop all rooms accordingly." },
  6: { title:"Bays / Outside Rooms / Perimeter",
       body:"Sweep, wash and squeegee/mop apparatus bays and exterior rooms. Organize exterior "
          + "rooms and work areas. Replace any equipment to its proper place. Wash aprons and "
          + "porch areas. Dust/wash gear racks. Remove cobwebs. Clean exterior and bay windows. "
          + "Pick up around the outside of the station." },
  0: { title:"Sock Hood Sunday",
       body:"Wash sock hood regardless of condition. Inspect PPE for cleanliness and wash if needed." }
};
