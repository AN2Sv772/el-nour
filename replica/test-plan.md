# Test plan — El Nour (Analify-inspired transformation)

Method: `replica-test`. Flows come from `replica/recon.md`; the new flows of
this build (F12–F18) come from the master prompt's Phase 6/7 work.

**Environment** — local dev server (`http://localhost:3000`), real Supabase
production data, authenticated with a minted admin session
(`scripts/mint-admin-session.cjs`). No seeded or fake business data is used
anywhere in this plan: the tests read the store's real records.

**Case id** — `Fxx-Hn` happy path · `Fxx-En` edge case · `Fxx-Nn` negative.

---

## F01 — Owner asks a business question

| id | case | expected |
|----|------|----------|
| F01-H1 | Ask "كم مبيعاتي؟" in the agent | An answer card with the number, the window, the calculation and the sources |
| F01-H2 | Ask "ما هي أكتر المنتجات ربحًا؟" | A product list; margin only where the cost exists |
| F01-H3 | Ask "إيه صافي الربح الحقيقي؟" | Profit **withheld** with the reason, not a number equal to sales |
| F01-E1 | No provider configured | The deterministic tools answer; the UI states that no model is connected |
| F01-E2 | Arabic Egyptian phrasing ("النهارده") | Same answer as the formal phrasing |
| F01-E3 | English question | Same behaviour, English labels |
| F01-N1 | Unauthenticated request to `/api/ai/chat` | 401/redirect — no answer |
| F01-N2 | A question with no data behind it | "غير متاح" + the missing list |

## F04 — AI prepares a change, the owner approves it

| id | case | expected |
|----|------|----------|
| F04-H1 | Propose an expense from the chat | A pending approval card appears in `/approvals` |
| F04-H2 | Approve it (admin) | Executes once, logs the before/after, status becomes completed |
| F04-H3 | Undo a completed approval | The previous value is restored and the undo is audited |
| F04-N1 | An employee tries to approve | 403 — the permission is re-checked at execution time |
| F04-N2 | Approve twice (double click) | The second attempt is refused; the action runs once (idempotency key) |
| F04-N3 | The `ai_approvals` table does not exist | 503 with the migration filename — not a crash |

## F05 — Owner checks today's business (the cockpit)

| id | case | expected |
|----|------|----------|
| F05-H1 | Open `/overview` | Six headline numbers, each with a status |
| F05-H2 | Switch the window (7 / 30 days) | Every number re-reads the same window engine |
| F05-H3 | Open `/dashboard` | Same revenue, same orders, same profit state as `/overview` |
| F05-E1 | Costs are missing | Profit = "—" with the reason and a link to `/setup/costs` |
| F05-E2 | No ads platform | ROAS = "غير متاح" — never a fake ratio |
| F05-E3 | Refresh mid-load | The skeletons appear, then the numbers |
| F05-N1 | Viewer without a session | Redirected to `/login` |

## F12 — COD risk review (new)

| id | case | expected |
|----|------|----------|
| F12-H1 | Open `/risk` | The readiness banner states whether delivery history exists |
| F12-H2 | An order with a missing address | Scored with the evidence (address + ageing) |
| F12-H3 | The customer refused before | The refusal history is the dominant signal, with the source |
| F12-E1 | No deliveries at all | Confidence drops to low and the page says the score is data-integrity only |
| F12-N1 | The page offers no "reject" action | Verified by inspection: the only action is verification |
| F12-N2 | No sensitive attributes | The engine's signals contain no gender/religion/income field (code review + test) |

## F13 — Anomalies (new)

| id | case | expected |
|----|------|----------|
| F13-H1 | Open `/anomalies` | Each anomaly shows the baseline next to the actual value |
| F13-H2 | Shipping fee ≠ configured fee | The mismatch is flagged with both numbers |
| F13-E1 | A short series (< 7 days) | No trend anomalies — no false alarms on small samples |
| F13-E2 | A flat series with one spike | The spike is flagged (leave-one-out baseline) |
| F13-N1 | Healthy data | The page says there is nothing wrong |

## F14 — Demand forecast (new)

| id | case | expected |
|----|------|----------|
| F14-H1 | Open `/forecast` | Method, measured MAPE, confidence and the assumptions are published |
| F14-H2 | Change the horizon (7/14/30/60/90) | The series and the expected totals change |
| F14-E1 | Fewer than 7 days of history | "بيانات غير كافية" — no forecast |
| F14-E2 | Inventory not tracked | No depletion date is invented |
| F14-N1 | The forecast is never described as "AI prediction" | The page says it is a statistical baseline |

## F15 — Profit simulator (new)

| id | case | expected |
|----|------|----------|
| F15-H1 | Move the price lever +10% | Revenue and profit move; the assumptions list the lever |
| F15-H2 | No levers | Zero change — a no-op simulation must not show a rounding difference |
| F15-E1 | Costs missing | Net profit stays "—" with the reason |
| F15-E2 | Conversion −200% | Orders and revenue clamp at 0, never negative |
| F15-N1 | The endpoint writes nothing | Verified: the route only reads (code review + no write calls) |

## F16 — Daily briefing (new)

| id | case | expected |
|----|------|----------|
| F16-H1 | Open `/briefing` | Today's real numbers, the risks, and the proposed tasks |
| F16-H2 | A task with a business-changing action | It is marked "تحتاج موافقة" and is not executed |
| F16-E1 | Nothing is wrong | "لا شيء حرج اليوم" |
| F16-E2 | Data gaps | The page lists what it could NOT say |

## F17 — Cost entry (new)

| id | case | expected |
|----|------|----------|
| F17-H1 | Open `/setup/costs` | Every product with its price and the current cost state |
| F17-H2 | Type a cost | The margin preview appears immediately |
| F17-H3 | Save | The cost is written with an audit row, and the coverage improves |
| F17-E1 | A negative or non-numeric cost | Rejected |
| F17-N1 | An employee tries to save | 403 |

## F18 — Performance (new)

| id | case | expected |
|----|------|----------|
| F18-H1 | `/api/metrics/overview` cold | < 3 s (was 9.4 s before the parallel read + cache) |
| F18-H2 | The same request again | < 0.5 s (the 20-second cache) |
| F18-H3 | The numbers after the cache expires | Identical values — the cache never changes the arithmetic |

---

## Automation

| kind | where |
|------|-------|
| Unit (pure engines) | `src/lib/**/*.test.ts` — 440 tests |
| API + DOM | `e2e/` Playwright specs (see `e2e/README.md`) |
| Manual click-through | this document's "manual pass" list below |

### Manual pass (cannot be automated here)

- Offline behaviour of the PWA shell (not built).
- Voice input (not built).
- PDF/Excel/WhatsApp delivery of the reports (not built — no provider).
- Real EasyOrders webhook from the vendor (needs a real order).

## Totals

- Planned cases: **58**
- Automated: **440 unit tests + the API/DOM sweep below**
- Passed: see `replica/qa-report.md`
- Failed: see `replica/bugs.md`
