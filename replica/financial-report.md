# Financial report — El Nour Business OS

**Date** — 2026-11-21 · **Currency** — EGP (ج.م) · **Timezone** — Africa/Cairo
· **Source of truth** — the live `orders`, `order_items`, `products`,
`collection_batches`, `expenses`, `daily_reconciliations` tables.

> **The headline of this report is a refusal.** The product's financial layer
> is fully built and fully tested, and it still refuses to publish a profit —
> because the inputs are missing. Everything below states what is known, what
> is not, and what each missing input would unlock.

---

## 1. What the data says (actual, from the records)

| item | value | status | source |
|------|-------|--------|--------|
| orders (all time) | 2,023 | actual | `orders` |
| orders, last 30 days | 742 | actual | `orders.created_at` |
| orders, last 7 days | ~120 | actual | `orders.created_at` |
| revenue, last 30 days | 315,880 ج.م | actual | `orders.total_amount` |
| open order value | 755,232 ج.م | actual | `orders` where status not in (delivered, cancelled) |
| orders older than 30 days | 1,257 · 431,787 ج.م | actual | `orders.created_at` |
| delivered orders | **0** | actual | `orders.status` |
| confirmed orders | 46 | actual | `orders.status` |
| pending orders | 1,977 | actual | `orders.status` |
| payment state `pending` | **every order** | actual | `orders.payment_status` |
| shipping fee collected | 59.85 ج.م per order | actual | `orders.shipping_fee` |
| shipping fee configured | 30 ج.م | actual | `business_settings.default_shipping_fee` |
| products without a purchase cost | 12 of 12 | actual | `products.cost_price = 0` |
| operating expenses | none recorded | actual | `expenses` |
| collection batches | none recorded | actual | `collection_batches` |
| daily reconciliations | none recorded | actual | `daily_reconciliations` |

## 2. Why the profit is withheld

Net profit needs four inputs. Here is their state:

| input | state | what it blocks |
|-------|-------|----------------|
| product cost | **missing** (12 products at 0) | COGS → net profit, margin per order, product economics |
| operating expenses | **missing** (no rows) | net profit, operating margin |
| advertising spend | **unavailable** (no ads platform) | net profit, ROAS |
| collections / cash | **missing** (no batches) | cash collected, cash on hand, the cash panel |

The product therefore reports:

- **net profit** → `—` + "محجوب: تكلفة المنتجات ناقصة · مصروف الإعلانات غير متاح · لا تُسجَّل مصروفات في النظام";
- **ROAS** → `غير متاح` + "لا يوجد اتصال بإعلانات مدفوعة";
- **profit per order** → `—` + "صافي الربح غير محتسب بعد";
- **cash collected** → `غير متاح` + "لا توجد دفعات تحصيل مسجّلة";
- **RTO exposure** → **40,480 ج.م (120 orders)** — the one money figure that is
  computable today, because it is an exposure, not a margin;
- **delivery rate** → **0%** — no order is marked delivered.

**The number the product refuses to show** is the trap: `revenue − 0 − 0 − 0`
would read as a profit of 315,880 ج.م on the last 30 days. That number is
wrong, and the product says so in the interface, not only in the source code.

## 3. The three financial findings that matter now

### 3.1 The shipping fee is being collected at twice the configured rate

59.85 ج.م is charged and collected per order, against a 30 ج.م setting. On
742 orders in 30 days that is **22,159 ج.م** above the configured price. Two
readings, and the product does not pick one silently:

- the **setting** is stale (the owner raised the real courier price to 59.85
  and forgot to update it) — then the fix is a one-field update; or
- the **charge** is wrong (the owner is overcharging every customer by 29.85
  ج.م) — then the fix is in the order flow, and the customer impact is
  already live.

The anomaly engine flags the mismatch with both numbers; it does not decide
which one is wrong, because only the owner knows which is true.

### 3.2 Nothing is marked delivered, and nothing is marked paid

1,977 of 2,023 orders are pending, 46 confirmed, **0 delivered**, and every
order's payment state is `pending`. Either the EasyOrders status sync is
stopped, or the courier's webhooks are not reaching the system. Until one of
those is true, **no margin, no cash and no customer analytics can be trusted**
— not because the product lacks the code, but because the evidence is missing.

This is also why the risk engine reports a **low-confidence** score: with zero
deliveries in the history, it cannot learn what a refusal looks like. It says
so on the screen instead of pretending to be certain.

### 3.3 The backlog is the balance sheet

1,257 orders older than 30 days, worth 431,787 ج.م — 57% of the open order
value (755,232 ج.م) sits in orders that are more than a month old. At a 0%
delivery rate, that number is not a revenue figure; it is a collection risk
with a delivery attached.

## 4. The unit economics that are computable today

| measure | value | why it is computable |
|---------|-------|---------------------|
| average order value (30 days) | ~425.71 ج.م | `sum(total_amount) / count` |
| revenue concentration | the top product carries the majority of the revenue | from the order items |
| shipping as a share of revenue | 59.85 / ~425.71 ≈ **14.1%** of every order | from the records |
| cash exposure (RTO) | 40,480 ج.م in the last 7 days | undelivered value |
| cost of goods | **unavailable** | `products.cost_price = 0` |

The 14.1% shipping share is the only cost ratio that can be stated today. It
is also the clearest reason the cost data matters: without the purchase cost,
the owner cannot tell whether the 14.1% shipping is a problem or the COGS is
a bigger one.

## 5. What each missing input unlocks — the owner's financial checklist

| # | action | where | unlocks | effort |
|---|--------|-------|---------|--------|
| 1 | Enter the purchase cost of the 12 products | `/setup/costs` | net profit, margin per order, product economics, the profit line on the chart | ~20 min |
| 2 | Register the operating expenses | `/reports` | the true net profit, the operating margin | one session |
| 3 | Fix the shipping-fee mismatch (setting or charge) | `/settings` + the anomaly card | removes a 22,159 ج.م/month ambiguity | 5 min |
| 4 | Restore the EasyOrders status sync | `/settings/integrations` | delivery rate, cash, customer analytics, the risk engine's confidence | a diagnosis |
| 5 | Record the collection batches and the daily reconciliation | `/collections`, `/reconciliation` | cash collected, cash on hand, the cash panel | daily habit |
| 6 | Connect the ads platform (Meta/TikTok/Google) | `/marketing` | ROAS, ad profitability | an account + a token |

Items 1, 2, 4 and 5 are the difference between a dashboard that shows 315,880
ج.م of sales and a system that shows what the business **earned**.

## 6. Financial risks the product is already watching

| risk | severity | what the product says |
|------|----------|------------------------|
| no delivery at all | critical | "التوسّع خطير الآن — التسليم أو الهامش معطّل، أصلح قبل أن تزيد الإنفاق" |
| the backlog ageing | critical | 1,257 orders > 30 days, 431,787 ج.م |
| the RTO exposure | critical | 40,480 ج.م in 7 days |
| the shipping fee mismatch | warning | 59.85 collected vs. 30 configured |
| no cost coverage | warning | 12 products without a purchase cost |
| no payment state | warning | every order is `pending` |
| no reconciliation | warning | no daily reconciliation in the period |

The product's own verdict on the period: **"التوسّع خطير الآن"** — expand
nothing until the delivery and the margin are fixed. That verdict is computed
from the records, not written by hand.

## 7. The financial verdict

The revenue engine is correct, fast and honest. **The business cannot yet be
valued from its own books**, and that is a data problem with a known owner
and a known cost: one session to enter the costs, one fix to the status sync,
one daily habit to record the reconciliation. Until then, the product
publishes the exposure (40,480 ج.م at risk, 431,787 ج.م ageing, 22,159 ج.م of
shipping ambiguity) — which is the truth — and withholds the profit, which
would be a lie.
