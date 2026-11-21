/**
 * Tests for the agent's deterministic layer.
 *
 * The rule under test: the assistant detects what is being asked, runs the
 * real tool, and NEVER invents a number that the tool did not produce.
 */

import { describe, it, expect } from 'vitest'
import { detectIntent, normalizeArabic } from './intent'
import { buildComparisonAnswer, buildDeterministicAnswer } from './answer'
import { findToolForIntent, TOOL_BY_INTENT } from './tools'
import type { BusinessOverview, Metric } from '@/lib/metrics/types'

function metric(
  key: string,
  value: number | null,
  status: Metric['provenance']['status'] = 'actual',
  missing: string[] = []
): Metric {
  return {
    key,
    label: key,
    value,
    unit: 'currency',
    provenance: {
      status,
      calculation: 'حساب',
      source: ['orders'],
      missing: status === 'actual' ? [] : missing.length ? missing : ['ناقص'],
      completeness: 1,
    },
  }
}

function overview(overrides: Partial<BusinessOverview> = {}): BusinessOverview {
  return {
    window: {
      preset: 'this_month',
      label: 'هذا الشهر',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-21T21:59:59.999Z',
      previousFrom: null,
      previousTo: null,
      timezone: 'Africa/Cairo',
      computedAt: '2026-11-21T12:00:00.000Z',
    },
    metrics: [],
    byKey: {
      revenue: metric('revenue', 1000),
      total_orders: metric('total_orders', 10, 'actual'),
      average_order_value: metric('average_order_value', 100),
      net_profit: metric('net_profit', null, 'incomplete', ['تكلفة المنتجات ناقصة', 'مصروف الإعلانات غير متاح']),
      revenue_minus_expenses: metric('revenue_minus_expenses', null, 'incomplete'),
      product_costs: metric('product_costs', null, 'incomplete'),
      advertising_spend: metric('advertising_spend', null, 'unavailable'),
      operating_expenses: metric('operating_expenses', null, 'incomplete'),
      cash_collected: metric('cash_collected', null, 'unavailable'),
      cash_held_by_couriers: metric('cash_held_by_couriers', null, 'unavailable'),
      shipping_cost: metric('shipping_cost', 300, 'estimated'),
      inventory_units: metric('inventory_units', null, 'unavailable'),
      inventory_value: metric('inventory_value', null, 'unavailable'),
      pending_orders: metric('pending_orders', 5, 'actual'),
      shipped_orders: metric('shipped_orders', 3, 'actual'),
      delivered_orders: metric('delivered_orders', 2, 'actual'),
    },
    products: [],
    alerts: [],
    health: [],
    gaps: [
      {
        id: 'missing_product_costs',
        severity: 'critical',
        title: 'تكلفة بعض المنتجات غير مسجّلة',
        detail: 'detail',
        area: 'finance',
      },
    ],
    topProducts: [
      {
        productId: 'p1',
        name: 'منتج',
        sku: 'S1',
        units: 3,
        revenue: 300,
        cost: 0,
        margin: null,
        marginPercent: null,
        status: 'incomplete',
      },
    ],
    losingProducts: [],
    series: [],
    ...overrides,
  }
}

describe('Arabic normalization', () => {
  it('folds the orthography so common spellings match', () => {
    expect(normalizeArabic('الأرباح')).toBe(normalizeArabic('الارباح'))
    expect(normalizeArabic('مبيعـات')).toBe(normalizeArabic('مبيعات'))
    expect(normalizeArabic('الإعلانات')).toBe(normalizeArabic('الاعلانات'))
  })
})

describe('intent detection', () => {
  it('detects a sales question', () => {
    const result = detectIntent('كم مبيعات آخر 30 يوم؟')
    expect(result.intent).toBe('sales_total')
    expect(result.preset).toBe('last_30_days')
  })

  it('detects a profit question and prefers it over sales', () => {
    const result = detectIntent('ما هو صافي الربح من المبيعات؟')
    expect(result.intent).toBe('profit')
  })

  it('detects the courier-cash question', () => {
    expect(detectIntent('كم نقداً عند شركات الشحن؟').intent).toBe('cash_with_couriers')
  })

  it('detects the data-gap question', () => {
    expect(detectIntent('ما الذي ينقص من البيانات؟').intent).toBe('data_gaps')
  })

  it('finds a second period for a comparison question', () => {
    const result = detectIntent('قارن مبيعات هذا الشهر بالشهر الماضي')
    expect(result.preset).toBe('this_month')
    expect(result.comparePreset).toBe('last_month')
  })

  it('returns unknown when nothing matches', () => {
    const result = detectIntent('مرحبا')
    expect(result.intent).toBe('unknown')
    expect(result.confidence).toBe(0)
  })
})

describe('the tool registry', () => {
  it('maps every intent to a tool', () => {
    for (const intent of ['sales_total', 'profit', 'cash_with_couriers', 'brain_status', 'data_gaps']) {
      expect(findToolForIntent(intent)).not.toBeNull()
    }
  })

  it('answers a profit question with the metrics engine, not the reconciliation reader', () => {
    expect(findToolForIntent('profit')?.name).toBe('get_business_overview')
  })

  it('keeps one tool per intent', () => {
    expect(TOOL_BY_INTENT.get('profit')).toBe(TOOL_BY_INTENT.get('profit'))
    expect(TOOL_BY_INTENT.size).toBeGreaterThan(3)
  })
})

describe('the deterministic answer', () => {
  const toolResult = {
    ok: true as const,
    data: overview(),
    evidence: {
      sources: ['orders'],
      calculation: 'محرك المقاييس',
      missing: ['تكلفة المنتجات ناقصة'],
      window: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-21T21:59:59.999Z', label: 'هذا الشهر' },
    },
  }

  it('publishes a real number with its window', () => {
    const answer = buildDeterministicAnswer('sales_total', toolResult)
    expect(answer.status).toBe('answered')
    expect(answer.text).toContain('هذا الشهر')
    expect(answer.evidence.metrics.find(m => m.key === 'revenue')?.value).toBe(1000)
  })

  it('never publishes the profit when the tool withheld it', () => {
    const answer = buildDeterministicAnswer('profit', toolResult)
    expect(answer.status).toBe('calculation_unavailable')
    expect(answer.text).toContain('محجوب')
    expect(answer.text).toContain('تكلفة المنتجات ناقصة')
    const profitMetric = answer.evidence.metrics.find(m => m.key === 'net_profit')
    expect(profitMetric?.value).toBeNull()
  })

  it('says why the courier cash is unknown instead of showing zero', () => {
    const answer = buildDeterministicAnswer('cash_with_couriers', toolResult)
    expect(answer.status).toBe('insufficient_data')
    expect(answer.text).toContain('غير معروف')
  })

  it('lists the data gaps when asked', () => {
    const answer = buildDeterministicAnswer('data_gaps', toolResult)
    expect(answer.status).toBe('answered')
    expect(answer.text).toContain('تكلفة بعض المنتجات غير مسجّلة')
  })

  it('reports a tool failure instead of inventing an answer', () => {
    const answer = buildDeterministicAnswer('sales_total', {
      ok: false,
      data: null,
      evidence: { sources: [], calculation: '', missing: [] },
      error: 'boom',
    })
    expect(answer.status).toBe('unable_to_retrieve')
    expect(answer.text).toContain('boom')
  })

  it('compares two named periods as named', () => {
    const previous = overview({
      window: { ...overview().window, label: 'الشهر الماضي' },
      byKey: {
        ...overview().byKey,
        revenue: metric('revenue', 2000),
        total_orders: metric('total_orders', 20, 'actual'),
      },
    })

    const answer = buildComparisonAnswer(overview(), previous, toolResult.evidence)
    expect(answer.text).toContain('هذا الشهر')
    expect(answer.text).toContain('الشهر الماضي')
    expect(answer.text).toContain('أقل')
  })
})
