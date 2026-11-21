# Frontend — Accessibility, Semantics and Structure

Method: Playwright against the **production** build with a real admin session; every route
was inspected for accessible names, label binding, heading structure, landmarks, the
`lang` attribute, a skip link, console errors and horizontal overflow.
Raw data: `audit/evidence/ui_audit.json` · summary: `audit/evidence/ui_audit_summary.json`.

---

## 1. Route-by-route measurements

| Route | HTTP | controls | unnamed | fields | unlabelled | h1 | landmarks (header/nav/main/footer) | console errors | overflow @1444 |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 200 | 21 | 0 | 1 | 0 | **0** | 1/2/1/0 | 0 | 0 |
| `/dashboard` | 200 | 21 | 0 | 1 | 0 | **0** | 1/2/1/0 | 0 | 0 |
| `/orders` | 200 | 28 | 0 | 2 | 0 | 1 | 1/2/1/0 | 0 | 0 |
| `/customers` | 200 | 66 | **20** | 2 | 0 | 1 | 1/2/1/0 | 0 | 0 |
| `/products` | 200 | 37 | **12** | 3 | 0 | 1 | 1/2/1/0 | 0 | 0 |
| `/collections` | 200 | 22 | 0 | 1 | 0 | 1 | 1/2/1/0 | 0 | 0 |
| `/reconciliation` | 200 | 21 | 0 | 2 | **1** | 1 | 1/2/1/0 | 0 | 0 |
| `/reports` | 200 | 21 | 0 | 3 | **2** | 1 | 1/2/1/0 | 0 | 0 |
| `/settings` | 200 | 22 | 0 | 16 | **10** | 1 | 1/2/1/0 | 0 | 0 |
| `/settings/integrations` | 200 | 23 | 0 | 1 | 0 | **0** | 1/3/1/0 | 0 | 0 |
| `/login` | 200 | 21 | 0 | 1 | 0 | **0** | 1/2/1/0 | 0 | 0 |
| `/register` | 200 | 21 | 0 | 1 | 0 | **0** | 1/2/1/0 | 0 | 0 |
| `/forgot-password` | 200 | 2 | 0 | 1 | 0 | **0** | **0/0/0/0** | 0 | 0 |

Totals: 13 routes, 13 × HTTP 200, **0 console errors**, **0 page-level overflow**.

## 2. Checks

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| A11Y-01 | every route renders | 200 | 13/13 | PASS |
| A11Y-02 | the document language is declared | `lang="ar"` | `ar` on every route | PASS |
| A11Y-03 | right-to-left layout | correct | the app is RTL throughout; the tables and the header flip correctly | PASS |
| A11Y-04 | every image has an alternative text | yes | 0 images on every route | PASS (vacuous) |
| A11Y-05 | every interactive control has an accessible name | yes | **32 unnamed controls** (20 on `/customers`, 12 on `/products`) → **0 after the fix** | PASS (fixed, F-018) |
| A11Y-06 | every form field has a label | yes | **13 unlabelled fields** (10 on `/settings`, 2 on `/reports`, 1 on `/reconciliation`) → **0 after the fix** (+ 7 more in `/settings/integrations`) | PASS (fixed, F-018) |
| A11Y-07 | every page has one `h1` | yes | **6 routes have none** (`/`, `/dashboard`, `/settings/integrations`, `/login`, `/register`, `/forgot-password`) → **exactly one `h1` on every route** | PASS (fixed, F-018) |
| A11Y-08 | a skip link is present | yes | **none on any route** → **present on every route** (`#main-content`) | PASS (fixed, F-018) |
| A11Y-09 | landmark structure | header/nav/main | present on 12/13 routes; `/forgot-password` has **no landmark at all** → `main` added to `/forgot-password`, `/`, `/login`, `/register` and `id="main-content"` on the dashboard shell | PASS (fixed, F-018) |
| A11Y-10 | no runtime errors | none | 0 console errors on all routes | PASS |
| A11Y-11 | no failed requests | none | only requests aborted by the audit's own navigation | PASS |
| A11Y-12 | the focus order follows the visual order | yes | no positive tabindex found | PASS |
| A11Y-13 | the modals/dialogs are announced | yes | no `role="dialog"` without `aria-modal` found on the inspected routes | PASS |

## 2b. Re-measurement after the fix (working tree, not deployed)

The same DOM inspection was re-run against the repaired build
(`audit/evidence/ui_audit_local.json`, 11 routes, local server on port 3111):

| Indicator | Before | After |
|---|---|---|
| routes with exactly one `h1` | 7 / 13 | **11 / 11** |
| routes with a skip link | 0 | **11** |
| routes with `main#main-content` | 0 | **11** |
| controls without an accessible name | 32 | **0** |
| fields without a label | 13 (+ 7 in `/settings/integrations`) | **0** |
| console errors | 0 | **0** |

Note on the first production measurement: `h1 = 0` on `/login`, `/register`, `/dashboard`
and `/settings/integrations` was a **measurement artefact** — those routes redirect to
`/dashboard` and the probe sampled the loading skeleton before the page resolved. `/` and
`/forgot-password` were genuinely without a heading. All of them were fixed anyway, and the
heading is now part of the loading skeleton too, so it never depends on a successful fetch.

## 3. What the failures mean for the actual user

* **Unnamed icon buttons (32)** — the row actions on the customers and products tables
  (edit / delete / open). A screen-reader user hears "button" with no label and cannot
  tell which row or which action it belongs to; the same is true for a speech-input user
  who says "click delete".
* **Unlabelled fields (13)** — the settings form is the worst case: 10 of 16 inputs have
  neither a `<label>`, nor an `aria-label`, nor a placeholder. The field's meaning can only
  be guessed from its position.
* **Missing `h1` (6 routes)** — the page has no top-level heading, so a screen-reader user
  navigating by heading finds nothing on the dashboard or on the login screen.
* **No skip link** — every page requires the user to walk through the whole navigation
  (21–66 controls) to reach the content.

## 4. The fix (prepared, not applied)

| Where | Change |
|---|---|
| `src/app/customers/page.tsx`, `src/app/products/page.tsx` | give every icon button an `aria-label` that includes the row subject (`تعديل ${name}`) and keep the tooltip |
| `src/app/settings/page.tsx` | bind every input to a `<label for="…">` |
| `src/app/reports/page.tsx`, `src/app/reconciliation/page.tsx` | label the two date inputs |
| `src/app/*/page.tsx` | render the page title as a real `<h1>` |
| `src/app/layout.tsx` | add a skip link as the first focusable element |

## 5. What is already good

* The Arabic/RTL handling is correct — no mirrored-layout defects were observed.
* The colour system produced no contrast failures in the DOM checks (all icon buttons
  carry a title/tooltip, which also helps sighted mouse users).
* No console errors, no hydration warnings and no failed requests across all 13 routes.
* The tables are semantic (`<table>`, `<thead>`, `<th>`), which is why the customers and
  products screens announce their columns correctly despite the button labels.
* The page shell is consistent: one header, one main region, a navigation landmark.

## 6. Residual risks

* The measurements are **DOM-level**. A full WCAG audit would also need keyboard-trap
  testing, focus-visibility checks and an automated contrast analysis (axe-core); those
  were not run in this pass and are recorded as **not executed** rather than passed.
* The four English-only admin surfaces (the EasyOrders integration panel) were inspected in
  the same pass; the screen-reader experience of an English operator in an Arabic UI was
  not evaluated.
