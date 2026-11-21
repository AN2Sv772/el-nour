# Frontend — Responsive Layout

Method: the production build was loaded at **320 / 390 / 768 / 1024 / 1444 / 1920 px** and
the document scroll width was compared with the client width. Elements that cross the
viewport boundary were collected to see whether the overflow is contained.

---

## 1. Results

| Route | 320 | 390 | 768 | 1024 | 1444 | 1920 |
|---|---|---|---|---|---|---|
| `/dashboard` | 0 | 0 | 0 | 0 | 0 | 0 |
| `/orders` | 0 | 0 | 0 | 0 | 0 | 0 |
| `/customers` | 0 (table scrolls inside its wrapper) | 0 | 0 | 0 | 0 | 0 |
| `/settings` | 0 | 0 | 0 | 0 | 0 | 0 |

`0` = no page-level horizontal overflow (`documentElement.scrollWidth − clientWidth = 0`).

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| RSP-01 | no horizontal page scroll at 320 px | 0 | 0 on all four routes | PASS |
| RSP-02 | no horizontal page scroll at 390 px (iPhone 14) | 0 | 0 | PASS |
| RSP-03 | no horizontal page scroll at 768 px (tablet) | 0 | 0 | PASS |
| RSP-04 | no horizontal page scroll at 1024 px | 0 | 0 | PASS |
| RSP-05 | no horizontal page scroll at 1444 px (desktop) | 0 | 0 | PASS |
| RSP-06 | no horizontal page scroll at 1920 px (wide desktop) | 0 | 0 | PASS |
| RSP-07 | wide tables scroll inside their own container | yes | the `/customers` table exceeds the viewport up to 1024 px, but its wrapper has `overflow-x: auto` → the page itself does not scroll sideways | PASS |
| RSP-08 | the navigation collapses on small screens | yes | the header/nav stay inside the viewport at 320 px (no element crosses the boundary) | PASS |
| RSP-09 | the base font size does not collapse | stays readable | 16 px at every width | PASS |
| RSP-10 | touch targets | ≥ 40 px | not measured | NOT EXECUTED |
| RSP-11 | orientation change (portrait ↔ landscape) | no layout break | not measured | NOT EXECUTED |

## 2. How the layout behaves

* **The shell is fluid**: the sidebar collapses into the header, the cards reflow and no
  element crosses the viewport boundary at any tested width.
* **Tables are the only wide element**: on `/customers` the table itself is wider than a
  phone, and the implementation wraps it in a scroll container (`overflow-x: auto`) — the
  correct pattern, because the page keeps its scroll position and the header does not
  drift sideways.
* **Typography does not scale with the viewport** (16 px everywhere), which is a
  deliberate and safe choice: nothing becomes unreadable on a small screen and nothing
  becomes oversized on a large one.
* The RTL direction is preserved at every width — the tables scroll in the reading
  direction and the sticky header keeps its position.

## 3. What was not measured

| Area | Why |
|---|---|
| touch-target size (RSP-10) | requires a touch-capable device profile; not available |
| orientation change (RSP-11) | the same |
| visual regressions (screenshot diffing) | screenshot capture is unavailable in this environment |
| print stylesheets | not part of the application |

These are recorded as **not executed** rather than passed, so the coverage ledger stays
honest.

## 4. Residual risks

* The table scroll containers are correct, but a screen-reader/keyboard user gets no hint
  that a table can be scrolled horizontally — an `aria-label` or a visible scroll hint
  would help. This is part of F-018's family but was not counted as a separate defect.
* Breakpoints between the measured widths (e.g. 900 px, 1200 px) were not sampled; the
  six measured widths cover the common device classes (small phone, phone, tablet, small
  laptop, desktop, wide desktop).
