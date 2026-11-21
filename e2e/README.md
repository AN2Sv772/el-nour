# e2e — El Nour Business OS

Playwright suite for the replica build. It runs against the **live database**
and the **local dev server** — there is no mock server and no seeded data.

## Run it

```bash
# 1. the dev server must be running on :3000
npm run dev

# 2. run the suite
npx playwright test                      # both projects
npx playwright test --project=desktop-chromium
npx playwright test --project=mobile-chromium

# 3. with the external API key (the MCP / /api/v1 checks)
REPORTS_API_KEY=… npx playwright test
```

Without `REPORTS_API_KEY` the MCP spec asserts the **fail-closed** contract
(401/503) and reports itself as skipped — it never pretends the endpoint
works.

## The authentication

The screens live behind the auth wall, so the suite mints a real admin
session with `scripts/mint-admin-session.cjs` and injects the cookie
(`e2e/helpers.ts`). No credential is stored in the repository.

## The guards

Every spec runs inside a fixture that fails the test on:

- **any console error** (a React key warning fails the run), and
- **any 5xx response**.

This is what caught bug B02 (a duplicated React key that silently dropped a
row of the daily briefing).

## The specs

| file | covers |
|------|--------|
| `overview.spec.ts` | F05 — the cockpit: the six headline numbers, the withheld profit with its reason, the window switch, and the agreement between `/overview` and `/dashboard` for the same window |
| `intelligence.spec.ts` | F12–F16 — the risk review, the anomalies, the forecast's published error, the simulator's zero-delta no-op, the briefing's blind spots |
| `flows.spec.ts` | F04 + F17 — the approvals endpoint fails closed with the migration name, the cost screen's read path and input validation, the API/MCP surface, the reports endpoint's honest statement |
| `responsive.spec.ts` | the horizontal-overflow contract at 360 → 1440 px, on every new screen |

## Selectors

Role/label based (`getByRole`, `getByText`), never CSS classes — the styling
may change without breaking the suite.

## Artifacts

Traces and screenshots are kept only for failures (`test-results/`, ignored by
git). The JSON report is written to `replica/e2e-results.json`.
