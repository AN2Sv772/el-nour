/**
 * The advertising connector contract.
 *
 * WHY A CONTRACT AND NOT AN INTEGRATION
 *
 * The store has no connected advertising platform, and the honest thing to
 * show for "ad spend" is `unavailable` — not a zero, not a guess.
 *
 * This file defines exactly what an adapter must return, so that connecting
 * Meta / TikTok / Google later is a drop-in rather than a rewrite: the
 * adapter reads the platform's own numbers, and everything downstream
 * (the metrics engine, the P&L, the decisions, the agent) picks them up
 * automatically through `MetricInputs.advertising`.
 *
 * Until an adapter is registered, `readAdvertisingSpend` returns
 * `unavailable` with the reason — which is what the UI shows today.
 */

export type AdPlatformId = 'meta' | 'tiktok' | 'google'

export interface AdPlatformDescriptor {
  id: AdPlatformId
  name: string
  /** What the platform reports natively (the currency of spend). */
  spendLabel: string
  /** Where the numbers come from once connected. */
  source: string
  /** The minimum access the connector needs. */
  requires: string[]
}

export const AD_PLATFORMS: AdPlatformDescriptor[] = [
  {
    id: 'meta',
    name: 'Meta Ads',
    spendLabel: 'الإنفاق الإعلاني',
    source: 'Meta Ads API — insights.spend',
    requires: ['Business Manager access token', 'ad_account_id', 'linked_ads', 'read_insights'],
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    spendLabel: 'الإنفاق الإعلاني',
    source: 'TikTok Ads API — report/integrated/platform',
    requires: ['advertiser_id', 'access_token', 'linked_ads', 'read_report'],
  },
  {
    id: 'google',
    name: 'Google Ads',
    spendLabel: 'الإنفاق الإعلاني',
    source: 'Google Ads API — campaign_cost',
    requires: ['customer_id', 'developer_token', 'linked_ads', 'read_campaigns'],
  },
]

export interface AdvertisingReadResult {
  /** null when no platform is connected — NEVER a fabricated zero. */
  spend: number | null
  source: string
  status: 'actual' | 'unavailable'
  missing: string[]
}

/**
 * An adapter reads the spend for a window from one platform.
 *
 * It MUST return the platform's own reported number — never an estimate.
 */
export interface AdPlatformAdapter {
  id: AdPlatformId
  readSpend(input: { from: string | null; to: string | null }): Promise<AdvertisingReadResult>
}

/** The registered adapters — empty until a platform is connected. */
const ADAPTERS: AdPlatformAdapter[] = []

/** Register a connected adapter (called by the integration layer). */
export function registerAdAdapter(adapter: AdPlatformAdapter): void {
  const index = ADAPTERS.findIndex(a => a.id === adapter.id)
  if (index >= 0) ADAPTERS[index] = adapter
  else ADAPTERS.push(adapter)
}

/** Remove an adapter (used when the owner disconnects a platform). */
export function unregisterAdAdapter(id: AdPlatformId): void {
  const index = ADAPTERS.findIndex(a => a.id === id)
  if (index >= 0) ADAPTERS.splice(index, 1)
}

/** Which platforms are connected right now. */
export function connectedAdPlatforms(): AdPlatformDescriptor[] {
  return AD_PLATFORMS.filter(p => ADAPTERS.some(a => a.id === p.id))
}

/**
 * Read the ad spend for a window.
 *
 * With no adapter connected this returns `unavailable` — and that is the
 * answer the whole product shows, consistently.
 */
export async function readAdvertisingSpend(input: {
  from: string | null
  to: string | null
}): Promise<AdvertisingReadResult> {
  if (ADAPTERS.length === 0) {
    return {
      spend: null,
      source: '',
      status: 'unavailable',
      missing: [
        'لا يوجد اتصال بإعلانات مدفوعة (Meta / TikTok / Google) — لا يمكن قياس الإنفاق',
      ],
    }
  }

  const results = await Promise.all(ADAPTERS.map(adapter => adapter.readSpend(input)))
  const usable = results.filter(r => r.spend !== null)

  if (usable.length === 0) {
    return {
      spend: null,
      source: '',
      status: 'unavailable',
      missing: ['المنصة المتصلة لم تُرجع إنفاقاً لهذه الفترة'],
    }
  }

  const spend = usable.reduce((s, r) => s + (r.spend ?? 0), 0)
  return {
    spend: Math.round(spend * 100) / 100,
    source: usable.map(r => r.source).join(' + '),
    status: 'actual',
    missing: results.filter(r => r.spend === null).flatMap(r => r.missing),
  }
}
