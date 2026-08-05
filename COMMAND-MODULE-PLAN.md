# Command Module — Build Plan

Branch: `command-module`. **Not deployed.** Nothing here reaches phones until this branch is
merged to `main` *and* `sw.js` `CACHE` is bumped. Keep it that way until it's been run on a
real incident-shaped drill.

Status: plan locked Aug 5 2026, revised same day against the SOG set in `Command Reference/`.
Phase 1 (skeleton and the log), Phase 2 (clocks, PAR, Wake Lock), Phase 3 (accountability
board, roles, command transfer, resources), and Phase 4 (PAR reasons, command/operational
mode, per-occupancy benchmarks) built and verified in-browser Aug 5 2026. All six source
documents in `Command Reference/` have now been read in full, including the Commercial/
Big-Box and High Rise bulletins.

---

## What it is

A single-screen incident command aid for the IC's own phone or tablet. Four jobs, one screen:

1. **Accountability board** — units on scene, assigned to divisions/groups/sectors
2. **Benchmark & PAR timers** — incident clock, 15-minute PAR, elapsed-time reminders
3. **Timestamped event log** — every action stamped automatically
4. **Tactical prompts** — what the SOG says to consider next, for this incident type

Ends with **one tap to export a plain-text timeline** you paste into the report.

## What it is not

- Not dispatch. No CAD, no data pulled from anywhere.
- Not shared. One device, no backend, no login, no sync, no server.
- Not the record of the incident. A scratchpad that produces a narrative you paste into
  the actual system of record.
- Not official. Same footer disclaimer as the rest of PFD Link, stated harder.

---

## Source documents

Everything operational in this module traces to a file already in `Command Reference/`:

| Source | What it gives the module |
|---|---|
| Procedure 307 — Fireground Accountability | PAR triggers, 15-minute interval, PAR report contents, IC/Division/Company responsibilities |
| Procedure 401 — Establishing Fireground Operations | First-five-minutes list, command modes, operational modes, the six task assignments, Level 1/2 staging |
| TB 21-03 Residential | Order-of-arrival assignments, single-family |
| TB 25-09 Multi-Family | Order-of-arrival assignments, multi-family |
| TB 25-10 Commercial / Big-Box | Order-of-arrival assignments, commercial |
| TB 25-12 High Rise | Order-of-arrival assignments, high rise |

**Copyright note.** 307 and 401 are Lexipol-copyrighted (published with permission by the
City of Pearland); the training bulletins are PFD's own. PFD Link is a public site, so the
module carries **short action phrases, never SOG prose** — "360 complete", "Water supply
established", "PAR — 15 min". Same operational facts, no republishing of Lexipol text. Do
not paste procedure paragraphs into `command.js`, even as comments.

---

## The one architectural decision everything hangs off

**The event log is the database. The board is a projection of it.**

Every user action appends an immutable entry:

```js
{ t: 1786012345678, kind: 'assign', unit: 'E2', to: 'Water Supply', note: '' }
```

The board, the timers, and the export are all *derived* by replaying that array. This buys
three things at once:

- **Export is free.** The timeline already exists; export is a formatter.
- **Undo is free.** Drop the last entry and re-derive.
- **Crash recovery is free.** The whole state is one JSON array, persisted on every append.
  A dead battery or an evicted tab costs nothing.

If you find yourself writing state that isn't in the log, stop — that's the bug.

## The one correctness rule

**Never count time with a counter. Always derive it from stored epoch timestamps.**

`setInterval` throttles or stops when the phone locks or the PWA backgrounds. A PAR clock
that drifts on a working fire is worse than no clock. So:

- Store `startedAt` as `Date.now()`.
- On every render tick, compute `Date.now() - startedAt`.
- A tick that never fires costs a stale display, not a wrong number — and it self-corrects
  the moment the screen comes back.

Corollary: a PAR that came due while the phone was locked must show, on return, a loud
persistent banner — *"PAR was due 4 minutes ago"* — not a chime you already missed.

### Honest limitation to design around

**Background audio alerts are not reliable.** A locked or backgrounded PWA on iOS cannot be
counted on to play a sound or fire a notification. Do not build this as if it will tap the
IC on the shoulder. Instead:

- Screen stays awake while an incident is active (Wake Lock API, with fallback).
- Overdue benchmarks are impossible to miss *on return to the screen*.
- Audio chimes are a bonus that fires when the screen is on, not the safety mechanism.

This goes in the FAQ too. An IC must not build a habit on a promise the phone can't keep.

---

## Roster

Hard-coded array, edited like `links.js`. Order here is station order, not due order.

```
Ladder 1    Medic 1
Engine 2    Medic 2
Engine 3    Medic 3
Ladder 4    Medic 4
Engine 5    Medic 5
Engine 8    Medic 8    Tower 8
Squad 1
Battalion 1
```

Notes that the code has to respect:

- **There is no Engine 1 and no Engine 4.** Stations 1 and 4 run ladders. So "1st due
  engine" in the deployment models is **a role filled by order of arrival, never a unit
  number.** The suggestion logic keys off "this is the Nth engine to arrive" — deriving it
  from the door number would be wrong at station 1 and 4 every single time.
- **Engine 81 substitutes for Tower 8** when the tower is down. Both in the roster, only
  one plausible on an incident; adding one greys the other.
- **Mutual aid** needs a free-text unit entry. It won't be on any roster.

### Units that don't behave like line companies

| Unit | Behavior |
|---|---|
| Battalion 1 | Not a board tile. Arriving logs **"Command transferred to Battalion 1"** — the thing that actually happens. |
| FMO | Two toggles, two timestamps: *requested* and *on scene*. No board position. |
| CenterPoint | Same two toggles. Utilities response is a timeline fact, not a division. |
| Squad 1 | Ordinary board unit. Assigned like an engine. |

---

## The board

### Granularity: unit-level, with crew splits where the SOG splits them

A unit is one tile carrying a personnel count — `E1 (4)`. That matches what a PAR actually
reports: unit designation, number of personnel, assigned task and location (307.3.2(g)3).

But **truck companies split, and that's normal, not an edge case.** Every ladder in all four
deployment models divides into High Side and Low Side with genuinely different jobs — Low
Side does primary search of the fire area, High Side searches the floor above. So:

- Ladders and Tower 8 offer a **Split crew** action, producing `L1 Low` and `L1 High` as
  two independently assignable tiles that still remember they're one unit.
- Splitting is one tap and reversible. Unsplit merges them back.
- Engines and Medics don't split by default; a manual split is available but not offered.
- **Split state is a log entry**, like everything else, so the export shows when the truck
  divided and where each half went.

### Assignment positions

The picker offers, per the SOG:

- **Task assignments (401.3):** Scene Safety · Initial Fire Attack · Primary Search &
  Rescue · Ventilation · RIT · Water Supply
- **Sectors:** A · B · C (Charlie) · D · Roof · Interior · Exposure
- **Medic-specific:** Outside Vent (OV) · Utilities · EMS / Medical Standby · Rehab ·
  Triage
- **Staging:** Level 1 · Level 2
- Free text for anything the list doesn't cover.

### Designated roles

Separate from position, because 307.3.2(a)1 makes the IC *directly* responsible for these
rather than accounting for them through a division:

- **Safety Officer** — designate any on-scene unit or a free-text name. Shown pinned near
  the top of the board, not buried in a division.
- **Accountability Officer** — 307.2 says assign one when the incident expands past the
  first unit. Same treatment.
- **Staging Area Manager** — 401.4.1 makes this the cue when Level 2 staging is announced.

---

## Deployment model suggestions — suggest, never auto-assign

At incident start you pick occupancy: **Single Family · Multi-Family · Commercial/Big-Box ·
Strip Mall · High Rise · Other**.

When you add a unit, the module works out its due-order role (2nd engine to arrive → "2nd
Due Engine") and offers that model's assignment as a **one-tap default sitting next to the
full picker**. Take it or ignore it.

Rules that keep this from becoming a liability:

- **Never auto-assign.** A suggestion that places a unit without a tap is wrong the moment
  reality diverges from the model, and reality always diverges.
- **Never block.** No warnings, no "the model says otherwise," no scoring.
- Suggestions are short action phrases, per the copyright note above.
- If occupancy is *Other*, no suggestions at all — just the picker.

Example: on a single-family fire, the 2nd engine to arrive is offered *Water Supply*; the
1st medic is offered *Outside Vent*; the 3rd engine is offered *RIT*.

---

## Data model

One key in localStorage: `pfd-cmd-active`.

```js
{
  v: 1,                       // schema version — check on load, migrate or discard
  id: 'inc-1786012345678',
  startedAt: 1786012345678,
  occupancy: 'single-family', // drives suggestions and the prompt list
  address: '',                // free text, optional, typed once
  commandMode: null,          // investigative | fast-attack | command
  opMode: null,               // offensive | defensive
  parDue: null,               // epoch ms, or null when no PAR running
  parIntervalMin: 15,         // 307.3.2(g)1(f)
  log: [ /* entries, append-only */ ]
}
```

Written synchronously after every append. It's small; don't be clever about it.

### Entry kinds

| kind | payload | shows on board |
|---|---|---|
| `incident-start` | occupancy, address | header |
| `command-mode` | mode | header |
| `op-mode` | mode | header + triggers PAR prompt on change to defensive |
| `unit-arrive` | unit, personnel | adds to Staging |
| `unit-split` / `unit-merge` | unit | splits tile into High/Low |
| `assign` | unit, to | moves unit to a position |
| `role` | role, who | pinned roles strip |
| `unit-clear` | unit | removes from board |
| `benchmark` | label | log only |
| `par` | reason, result | resets PAR clock |
| `resource` | which (FMO/CenterPoint), state | log only |
| `command-transfer` | to | header |
| `note` | text | log only |
| `incident-end` | — | closes |

Positions are not separate entities — a division exists because a unit is assigned to it.
Fewer moving parts, no orphan divisions to clean up.

**Schema versioning.** `v: 1` is checked on load. A future version that can't read an old
active incident **discards it and says so plainly** rather than half-loading.

---

## PAR

Straight from 307.3.2(g). Default interval **15 minutes**.

One big PAR button. Tapping it asks *why* — a one-tap reason list, because the reason
belongs in the report:

- Missing / trapped / injured firefighter
- Offensive → defensive change
- Catastrophic event (flashover, backdraft, collapse, Mayday)
- Emergency evacuation
- Fire under control
- 15-minute benchmark
- IC discretion

Then: **PAR started** → **PAR complete**, both timestamped, clock resets on complete.

The module also *prompts* for a PAR automatically when the log shows an op-mode change to
defensive or a "fire under control" benchmark — a suggestion in the prompt list, never a
forced modal.

PAR report contents (unit designation, personnel count, task and location) come free from
the board, so the export renders the board state at each PAR.

---

## Screen design

Built to be operated **one-handed, in gloves, in the dark, while talking on a radio.** That
constraint outranks density and it outranks looks.

- Tap targets no smaller than 48px; bigger for PAR and assign.
- No typing on the critical path. Units come from the tap-list; free text always available,
  never required.
- No confirmation dialogs on the critical path — undo instead. A dialog under stress is a
  second thing to get wrong.
- Destructive actions (end incident, clear all) *do* confirm; they're the only ones you
  can't undo your way out of.
- Reuse the existing dark palette from `duties.html` (`--bg #0f1216`, etc.). Do not invent a
  second theme.

```
┌────────────────────────────────────┐
│ ‹ Back    SINGLE FAMILY — 1420 Main│  sticky
│ 00:14:32  OFFENSIVE   PAR in 05:41 │  clocks + modes, always visible
├────────────────────────────────────┤
│ SAFETY: B1    ACCT: E3 Officer     │  pinned roles
├────────────────────────────────────┤
│  [ PAR ]  [ BENCHMARK ]  [ NOTE ]  │  big primary actions
├────────────────────────────────────┤
│ STAGING L1       M5(2)             │
│ FIRE ATTACK      E2(4)             │
│ SEARCH — LOW     L1 Low(2)         │
│ SEARCH — HIGH    L1 High(2)        │
│ RIT              E3(4)             │
│ OV / UTILITIES   M1(2)             │
│                      [ + UNIT ]    │
├────────────────────────────────────┤
│ NEXT CONSIDERATIONS                │  collapsible, per occupancy
│ ☐ 360 complete                     │
│ ☐ Water supply established         │
│ ☐ RIT in place                     │
├────────────────────────────────────┤
│ FMO ○ requested  ○ on scene        │
│ CenterPoint ○ requested ○ on scene │
├────────────────────────────────────┤
│ TIMELINE                     ▾     │  collapsed by default
│ 14:32  E2 → Water Supply           │
└────────────────────────────────────┘
```

Clocks and PAR never scroll away. Everything else can.

---

## Build phases

Each phase ends somewhere the branch is coherent and testable. Don't start the next until
the current one has been driven on a phone.

### Phase 1 — Skeleton and the log
`command.html` + `command.js`, linked from `index.html` behind a tile that only exists on
this branch. Start/end an incident, pick occupancy, append notes, persist. **No board, no
timers yet.**

Gate: kill the tab, reopen, the incident is exactly where you left it.

### Phase 2 — Clocks
Incident elapsed clock and 15-minute PAR countdown, both derived from timestamps per the
rule above. Wake Lock while active. Overdue-PAR banner on return to foreground.

Gate: start an incident, lock the phone ten minutes, come back. Clock is right and the
overdue banner is unmissable.

### Phase 3 — Accountability board
Roster, add unit with personnel count, assign via the position picker, clear. Truck/tower
crew split and merge. Battalion 1 command transfer, FMO/CenterPoint toggles, designated
roles strip. Every one of those appends to the log.

Gate: build a 12-unit incident faster than you could write it on a tactical worksheet, with
L1 split High/Low.

### Phase 4 — PAR reasons and benchmarks
The PAR reason list, command/operational mode declaration, benchmark checklist per
occupancy, auto-prompt on defensive change and fire-under-control.

Gate: every 307 PAR trigger is reachable in one tap from the main screen.

### Phase 5 — Deployment model suggestions
Due-order tracking (by arrival, never by unit number), per-occupancy suggestion tables,
one-tap accept. Suggestion data lives in its own file, editable like `links.js`.

Gate: on a single-family run, the 2nd arriving engine is offered Water Supply and the 1st
medic is offered OV — and ignoring both costs nothing.

### Phase 6 — Export
Format the log into a plain-text narrative. Copy to clipboard; Web Share where available.

```
INCIDENT — Single Family — 1420 Main St
Started 14:18  ·  Duration 00:47:12
Command: Fast Attack → Command  ·  Mode: Offensive

14:18  E2 on scene, command established
14:20  360 complete
14:22  E2 (4) → Initial Fire Attack
14:24  L1 split — Low Side (2), High Side (2)
14:31  Benchmark: water supply established
14:33  Command transferred to Battalion 1
14:40  PAR — 15 minute benchmark — complete, 18 personnel
14:52  CenterPoint on scene
15:05  Incident terminated
```

Gate: paste into the report system and have it be genuinely useful with no editing.

### Phase 7 — Undo, hardening, FAQ
Undo last action. Schema-version check. Confirmations on destructive actions only. FAQ entry
stating plainly what this is, that it's unofficial, that it isn't the record, and that
background alerts are not guaranteed.

### Phase 8 — Drill before merge
Run it on a training evolution or a tabletop with someone else calling the incident. Fix
what the drill exposes. **Only then** merge to `main` and bump `sw.js` `CACHE`.

---

## Open questions

Small enough not to block Phase 1–2, but needed by the phase noted.

- **Personnel counts** (Phase 3) — default staffing per unit type, so the count is one tap
  and not a number pad. Engines 4? Medics 2? Ladders 4? Squad?
- **Safety Officer** (Phase 3) — in practice, is it a Battalion Chief, a designated company
  officer, or varies? Affects whether the picker offers units or free text first.
- **Level 2 staging** — worth a Staging Area Manager designation, or rare enough in Pearland
  to leave as free text? (Level 2 Staging itself is already a position on the assign sheet;
  this is only about whether it deserves its own pinned role like Safety/Accountability.)
- ~~**Benchmark list**~~ — resolved. 25-10 and 25-12 were read in full for Phase 4; the
  per-occupancy checklist in `benchmarks.js` is sourced directly from them (2½" line/Charlie
  sector/roof division for commercial; attack stairwell/high-rise kit/standpipe/staging
  2-floors-below/lobby sector/elevators secured/evac stairwell for high-rise). Single-Family,
  Multi-Family, and Strip Mall get no additions beyond core — 21-03/25-09 don't describe
  benchmark-shaped content beyond what 401.3's core list already covers. Strip Mall appears
  as a column in all four deployment bulletins (it doesn't have its own dedicated bulletin
  the way Commercial/Big-Box and High Rise do) and reads as functionally identical to
  Multi-Family/Commercial in every one of them — no distinct purpose statement like High
  Rise's "four stories and above" or Commercial's 2½" hose requirement — so it gets core only
  rather than an invented differentiator.

## Deferred, deliberately

- Multi-device sync / safety officer mirror. Needs a backend, auth, and hosting cost, and
  puts incident data on a server. The append-only model keeps this *possible* later without
  being *built* now.
- Local history of finished incidents. Export-and-forget keeps the phone from becoming an
  unofficial records repository. Revisit only with a real need and a clear answer on
  records retention.
- Riding-position tracking below the crew-split level.
- CAD/dispatch integration.
