# Command Module — Build Plan

Branch: `command-module`. **Not deployed.** Nothing here reaches phones until this branch is
merged to `main` *and* `sw.js` `CACHE` is bumped. Keep it that way until it's been run on a
real incident-shaped drill.

Status: plan locked Aug 5 2026. Nothing built yet.

---

## What it is

A single-screen incident command aid for the IC's own phone or tablet. Four jobs, all on
one screen:

1. **Accountability board** — units on scene, assigned to divisions/groups
2. **Benchmark & PAR timers** — incident clock, PAR countdown, elapsed-time reminders
3. **Timestamped event log** — every action is stamped automatically
4. **Tactical prompts** — incident-type checklists of what to consider next

Ends with **one tap to export a plain-text timeline** you paste into the report.

## What it is not

- Not a dispatch feed. No CAD integration, no ActiveNet, no data pulled from anywhere.
- Not shared. One device. No backend, no login, no account, no sync, no server.
- Not the record of the incident. It's a scratchpad that produces a narrative you paste
  into the actual system of record.
- Not official. Same footer disclaimer as the rest of PFD Link, stated harder.

---

## The one architectural decision everything hangs off

**The event log is the database. The board is a projection of it.**

Every user action appends an immutable entry:

```js
{ t: 1786012345678, kind: 'assign', unit: 'E1', to: 'Div A', note: '' }
```

The unit board, the timers, and the export are all *derived* by replaying that array. This
buys three things at once:

- **Export is free.** The timeline already exists; export is a formatter.
- **Undo is free.** Append a compensating entry, or drop the last one and re-derive.
- **Crash recovery is free.** The whole state is one JSON array. Persist it on every
  append; a dead battery or a browser tab eviction costs nothing.

If you find yourself writing state that isn't in the log, stop — that's the bug.

## The one correctness rule

**Never count time with a counter. Always derive it from stored epoch timestamps.**

`setInterval` stops or throttles when the phone locks, the tab backgrounds, or iOS
suspends the PWA. A timer that drifts on a working fire is worse than no timer. So:

- Store `startedAt` as `Date.now()`.
- On every render tick, compute `Date.now() - startedAt`.
- A tick that never fires costs you a stale display, not a wrong number — and the moment
  the screen comes back it's correct.

Corollary: a PAR timer that "went off" while the phone was locked must show, on return, a
loud persistent banner — *"PAR was due 4 minutes ago"* — not a chime you already missed.

### Honest limitation to design around

**Background audio alerts are not reliable.** A backgrounded/locked PWA on iOS cannot be
counted on to play a sound or fire a notification. Do not build the module as if it will
tap the IC on the shoulder. Build it so that:

- The screen stays awake while an incident is active (Wake Lock API, with a fallback).
- Overdue benchmarks are impossible to miss *on return to the screen*.
- Audio chimes are a bonus that fires when the screen is on, not the safety mechanism.

This gets stated in the FAQ too. An IC must not build a habit on a promise the phone
can't keep.

---

## Data model

One key in localStorage: `pfd-cmd-active`.

```js
{
  v: 1,                       // schema version — check on load, migrate or discard
  id: 'inc-1786012345678',
  startedAt: 1786012345678,
  type: 'structure',          // structure | mva | medical | hazmat | other
  address: '',                // free text, optional, typed once
  parDue: null,               // epoch ms, or null when no PAR running
  parIntervalMin: 20,
  log: [ /* entries, append-only */ ]
}
```

Written synchronously after every append. It's small; don't be clever about it.

### Entry kinds

| kind | payload | shows on board |
|---|---|---|
| `incident-start` | type, address | header |
| `unit-arrive` | unit | adds to Staging |
| `assign` | unit, to | moves unit to a division |
| `unit-clear` | unit | removes from board |
| `benchmark` | label | log only |
| `par` | result: `complete` / `started` | resets PAR clock |
| `note` | text | log only |
| `incident-end` | — | closes |

Divisions are not a separate entity — a division exists because a unit is assigned to it.
Fewer moving parts, no orphan divisions to clean up.

### Schema versioning

`v: 1` is checked on load. If a future version can't read an old active incident, it
**discards it and says so plainly** rather than half-loading. An incident in progress
during an app update is an edge case worth one line of code and zero cleverness.

---

## Screen design

Built to be operated **one-handed, in gloves, in the dark, while talking on a radio.**
That constraint outranks density and it outranks looks.

- Tap targets no smaller than 48px. Bigger for the ones used under stress (PAR, assign).
- No typing on the critical path. Units come from a tap-list of Pearland apparatus;
  free text is available but never required.
- No confirmation dialogs on the critical path. Undo instead — a dialog under stress is a
  second thing to get wrong.
- Destructive actions (end incident, clear all) *do* confirm, because those are the only
  ones you can't undo your way out of.
- High contrast on the existing dark palette (`--bg #0f1216` etc. from `duties.html`).
  Reuse those variables — do not invent a second theme.

### Layout, top to bottom

```
┌────────────────────────────────────┐
│ ‹ Back      STRUCTURE — 1420 Main  │  sticky bar
│ 00:14:32          PAR in 05:41     │  clocks, always visible
├────────────────────────────────────┤
│  [ PAR ]  [ BENCHMARK ]  [ NOTE ]  │  big primary actions
├────────────────────────────────────┤
│ STAGING          E2  M4            │
│ DIVISION A       E1  L1            │  tap a unit → move sheet
│ ROOF             T1                │
│                      [ + UNIT ]    │
├────────────────────────────────────┤
│ NEXT CONSIDERATIONS                │  collapsible prompt list
│ ☐ 360 complete                     │  for the incident type
│ ☐ Water supply established         │
├────────────────────────────────────┤
│ TIMELINE                     ▾     │  collapsed by default
│ 14:32  E1 → Division A             │
└────────────────────────────────────┘
```

Clocks and the PAR button never scroll away. Everything else can.

---

## Build phases

Each phase ends somewhere the branch is coherent and testable. Don't start the next until
the current one has been driven on a phone.

### Phase 1 — Skeleton and the log
`command.html` + `command.js`, linked from `index.html` behind a tile that only appears on
this branch. Start/end an incident. Append notes. Persist to localStorage. Reload the page
mid-incident and confirm nothing is lost. **No board, no timers yet.**

Gate: kill the tab, reopen, incident is exactly where you left it.

### Phase 2 — Clocks
Incident elapsed clock and PAR countdown, both derived from timestamps per the rule above.
Wake Lock while an incident is active. Overdue-PAR banner on return to foreground.

Gate: start an incident, lock the phone for ten minutes, come back. The clock is right and
the overdue banner is unmissable.

### Phase 3 — Accountability board
Unit roster (Pearland apparatus, hard-coded like `links.js` — one array, easy to edit).
Add unit → lands in Staging. Tap unit → move sheet → assign to a division. Clear a unit.
Every one of those appends to the log.

Gate: build a 12-unit incident faster than you could write it on a tactical worksheet.

### Phase 4 — Benchmarks and prompts
Per-type checklists (`structure`, `mva`, `medical`, `hazmat`). Checking a benchmark logs it
with a timestamp. Prompts are *reminders, not requirements* — no blocking, no scoring, no
"you missed one."

Content for these must be **sourced from actual PFD SOG/SOP**, not written from general fire
service practice. Flag anything invented so it can be verified before merge.

### Phase 5 — Export
Format the log into a plain-text narrative. Copy to clipboard; Web Share where available.

```
INCIDENT — Structure — 1420 Main St
Started 14:18  ·  Duration 00:47:12

14:18  Command established
14:20  E1 on scene
14:22  E1 → Division A
14:31  Benchmark: water supply established
14:40  PAR complete
15:05  Incident terminated
```

Gate: paste into the report system and have it be genuinely useful with no editing.

### Phase 6 — Undo, hardening, FAQ
Undo last action. Schema-version check. Confirmations on destructive actions only. FAQ
entry stating plainly what this is, that it is unofficial, that it's not the record, and
that background alerts are not guaranteed.

### Phase 7 — Drill before merge
Run it on a training evolution or a tabletop with someone else calling the incident. Fix
what the drill exposes. **Only then** merge to `main` and bump `sw.js` `CACHE`.

---

## Open questions to resolve before Phase 3

- **Unit roster** — full Pearland apparatus list with the exact designators used on the
  radio. Mutual-aid units need a free-text fallback.
- **Division naming** — does PFD use Division A/B/C/D, geographic, or floor numbers?
  Match the SOG; don't invent a convention.
- **PAR interval** — what does the SOG actually specify? Default the timer to that.
- **Benchmark list** — pull from the SOG rather than from memory.

## Deferred, deliberately

- Multi-device sync / safety officer mirror. Would need a backend, auth, and hosting cost,
  and would put incident data on a server. The data model is append-only, so this stays
  *possible* later without being *built* now.
- Local history of finished incidents. Export-and-forget avoids the phone becoming an
  unofficial records repository. Revisit only if there's a real need and a clear answer on
  records retention.
- CAD/dispatch integration.
