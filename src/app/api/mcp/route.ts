import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyApiKey } from '@/lib/api/api-key'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { buildAnalytics } from '@/lib/analytics/engine'
import { buildDecisions } from '@/lib/decisions/engine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp — a Model Context Protocol server over HTTP (JSON-RPC 2.0).
 *
 * WHY
 *
 * An assistant that lives outside this app (a chat app, an automation, a
 * desk-side agent) should be able to ask the business questions and get the
 * SAME honest answers the dashboard gives — not a second, looser set of
 * numbers. This endpoint exposes exactly three read-only tools, all backed
 * by the shared engines:
 *
 *   get_business_metrics  — the metric set, with statuses and sources
 *   get_product_economics — revenue, cost, margin per product
 *   get_decisions         — what needs the owner's attention, with evidence
 *
 * READ-ONLY BY CONSTRUCTION: there is no write tool, and the server client
 * is only used to SELECT.
 *
 * Auth: `x-api-key` (or `Authorization: Bearer …`).
 */

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'el-nour-business-os', version: '1.0.0' }

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

const TOOLS = [
  {
    name: 'get_business_metrics',
    description:
      'The business metric set for a period — revenue, orders, profit (or why it is withheld), cash, shipping, inventory. Every metric carries its status, calculation and source tables.',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'string',
          description:
            'The period: today | yesterday | this_week | last_week | this_month | last_month | last_7_days | last_30_days | this_year | all',
        },
      },
    },
  },
  {
    name: 'get_product_economics',
    description:
      'Product-level revenue, units, cost and margin for a period, plus the revenue that was earned by products with no recorded cost.',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: { type: 'string', description: 'The period, same values as above.' },
      },
    },
  },
  {
    name: 'get_decisions',
    description:
      'The decisions the business owner should act on, each with the numbers that triggered it and the action that resolves it.',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: { type: 'string', description: 'The period, same values as above.' },
      },
    },
  },
]

async function runTool(name: string, args: Record<string, unknown>) {
  const supabase = createServiceClient()
  const dateRange = typeof args.dateRange === 'string' ? args.dateRange : 'last_30_days'

  switch (name) {
    case 'get_business_metrics': {
      const overview = await buildBusinessOverview(supabase, { dateRange })
      return {
        window: overview.window,
        metrics: overview.metrics.map(m => ({
          key: m.key,
          label: m.label,
          value: m.value,
          unit: m.unit,
          status: m.provenance.status,
          calculation: m.provenance.calculation,
          source: m.provenance.source,
          missing: m.provenance.missing,
        })),
        gaps: overview.gaps,
        alerts: overview.alerts,
      }
    }
    case 'get_product_economics': {
      const analytics = await buildAnalytics(supabase, { dateRange })
      return {
        window: analytics.window,
        status: analytics.productEconomics.status,
        summary: analytics.productEconomics.summary,
        totals: analytics.productEconomics.totals,
        concentration: analytics.productEconomics.concentration,
        blindRevenue: analytics.productEconomics.blindRevenue,
        blindProducts: analytics.productEconomics.blindProducts,
        products: analytics.productEconomics.products,
        statement: analytics.profitAndLoss.lines,
        cashFlow: {
          status: analytics.cashFlow.status,
          totals: analytics.cashFlow.totals,
          cashBackedRatio: analytics.cashFlow.cashBackedRatio,
          summary: analytics.cashFlow.summary,
        },
      }
    }
    case 'get_decisions': {
      const result = await buildDecisions(supabase, { dateRange })
      return result
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/**
 * Maximum number of JSON-RPC messages accepted in one batch request.
 *
 * The rate limiter counts HTTP requests, not JSON-RPC messages, so without a
 * cap a single request could carry an unbounded batch.
 */
const MAX_BATCH_MESSAGES = 20

export async function POST(request: NextRequest) {
  const auth = verifyApiKey(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      rpcError(null, -32700, 'Parse error — the body must be JSON-RPC 2.0'),
      { status: 400 }
    )
  }

  const messages = Array.isArray(body) ? body : [body]

  // One HTTP request may carry a BATCH of JSON-RPC messages, and every
  // `tools/call` in it runs a full metrics build. The rate limiter counts
  // HTTP REQUESTS, not messages — so one request could force unbounded work
  // and an unbounded response, taking the function instance down with it.
  if (messages.length > MAX_BATCH_MESSAGES) {
    return NextResponse.json(
      rpcError(
        null,
        -32600,
        `Too many messages in one batch — the maximum is ${MAX_BATCH_MESSAGES}`
      ),
      { status: 400 }
    )
  }

  const responses: unknown[] = []

  for (const message of messages) {
    const { id, method, params } = message

    switch (method) {
      case 'initialize':
        responses.push(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              'أرقام هذا المتجر تُقرأ من سجلاته الحقيقية فقط. أي رقم غير متاح يأتي بحالة تشرح سبب نقصه — لا تفترض قيمة.',
          })
        )
        break

      case 'notifications/initialized':
        // A notification has no id and expects no response.
        break

      case 'ping':
        responses.push(rpcResult(id, {}))
        break

      case 'tools/list':
        responses.push(rpcResult(id, { tools: TOOLS }))
        break

      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : ''
        const args =
          params?.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {}

        if (!TOOLS.some(t => t.name === name)) {
          responses.push(rpcError(id, -32602, `Unknown tool: ${name}`))
          break
        }

        try {
          const data = await runTool(name, args)
          // Serialise the payload ONCE. It used to be stringified twice (once
          // for the text block, once for the response body), so every message
          // cost about three times its own size.
          const text = JSON.stringify(data, null, 2)
          responses.push(
            rpcResult(id, {
              content: [{ type: 'text', text }],
              structuredContent: data,
              isError: false,
            })
          )
        } catch (error) {
          responses.push(
            rpcResult(id, {
              content: [
                {
                  type: 'text',
                  text: error instanceof Error ? error.message : 'Tool execution failed',
                },
              ],
              isError: true,
            })
          )
        }
        break
      }

      default:
        responses.push(rpcError(id, -32601, `Method not found: ${method}`))
    }
  }

  if (responses.length === 0) {
    // Notifications only — acknowledge with 202 and no body.
    return new NextResponse(null, { status: 202 })
  }

  return NextResponse.json(Array.isArray(body) ? responses : responses[0])
}

/** A GET explains how to use the endpoint (some MCP clients probe it). */
export async function GET(request: NextRequest) {
  const auth = verifyApiKey(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json({
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    transport: 'streamable-http',
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
    example: {
      method: 'tools/call',
      params: { name: 'get_business_metrics', arguments: { dateRange: 'last_30_days' } },
    },
  })
}
