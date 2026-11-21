import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  default: { requests: 100, windowMs: 60 * 1000 },
  auth: { requests: 10, windowMs: 60 * 1000 },
  webhook: { requests: 1000, windowMs: 60 * 1000 },
  write: { requests: 30, windowMs: 60 * 1000 },
  // Internal workers: the queue processor self-chains (one HTTP call per
  // batch) and the backfill scanner runs for tens of minutes. The generic
  // write limit (30/min) throttled the chain into a stall, because every
  // self-call hits the same rate-limit key.
  worker: { requests: 180, windowMs: 60 * 1000 },
} as const

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Hard cap on the number of tracked rate-limit buckets.
 *
 * The map was previously never pruned: every distinct (ip, path) pair added
 * an entry that stayed in memory for the lifetime of the instance. On a
 * long-lived instance that is an unbounded memory leak, and an attacker who
 * can vary the path (or spoof `x-forwarded-for`) can grow it at will.
 *
 * When the cap is reached, expired buckets are swept first; only if that is
 * not enough are the buckets closest to expiry dropped (they are the least
 * likely to still be enforcing a limit).
 */
const MAX_RATE_LIMIT_BUCKETS = 10_000

function pruneRateLimitStore(now: number): void {
  if (rateLimitStore.size <= MAX_RATE_LIMIT_BUCKETS) return

  // 1) Drop every bucket whose window already expired.
  for (const [key, record] of rateLimitStore) {
    if (now > record.resetAt) rateLimitStore.delete(key)
  }
  if (rateLimitStore.size <= MAX_RATE_LIMIT_BUCKETS) return

  // 2) Still too many: drop the buckets that expire soonest.
  const byExpiry = [...rateLimitStore.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  const excess = rateLimitStore.size - MAX_RATE_LIMIT_BUCKETS
  for (let i = 0; i < excess; i++) {
    rateLimitStore.delete(byExpiry[i][0])
  }
}

// Routes that don't require authentication
const publicRoutes = [
  '/login', '/register', '/auth/callback', '/forgot-password', '/reset-password',
  // Webhook + queue endpoints carry their OWN auth (secret header /
  // x-queue-trigger / CRON_SECRET) — middleware must not gate them or the
  // self-chaining processor dies with 401.
  '/api/integrations/easyorders/webhook',
  '/api/integrations/easyorders/process-queue',
  '/api/integrations/easyorders/backfill',
  '/api/integrations/easyorders/catch-up',
]
const publicPrefixes = ['/api/auth/', '/_next/', '/favicon.ico', '/public']

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '').split('?')[0]
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

function getRateLimitKey(request: NextRequest, prefix: string): string {
  const ip = getClientIp(request)
  const path = normalizePath(request.nextUrl.pathname)
  return `${prefix}:${ip}:${path}`
}

function checkRateLimit(key: string, config: { requests: number; windowMs: number }): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  pruneRateLimitStore(now)
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetAt) {
    const resetAt = now + config.windowMs
    rateLimitStore.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: config.requests - 1, resetAt }
  }

  if (record.count >= config.requests) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt }
  }

  record.count++
  rateLimitStore.set(key, record)
  return { allowed: true, remaining: config.requests - record.count, resetAt: record.resetAt }
}

function getRateLimitConfig(pathname: string, method: string): { requests: number; windowMs: number } {
  const normalizedPath = normalizePath(pathname)

  if (normalizedPath.startsWith('/api/auth/') ||
      normalizedPath.startsWith('/api/login') ||
      normalizedPath.startsWith('/api/register') ||
      normalizedPath.startsWith('/api/password')) {
    return RATE_LIMIT_CONFIG.auth
  }

  if (normalizedPath.includes('/webhook')) {
    return RATE_LIMIT_CONFIG.webhook
  }

  // Internal EasyOrders workers (queue processor + historical scanner).
  // Checked before the generic write limit so the self-chaining processor
  // is not throttled into a stall.
  if (
    normalizedPath === '/api/integrations/easyorders/process-queue' ||
    normalizedPath === '/api/integrations/easyorders/backfill' ||
    normalizedPath === '/api/integrations/easyorders/catch-up'
  ) {
    return RATE_LIMIT_CONFIG.worker
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return RATE_LIMIT_CONFIG.write
  }

  return RATE_LIMIT_CONFIG.default
}

function isPublicRoute(pathname: string, method: string): boolean {
  const normalized = normalizePath(pathname)
  // The order-confirmation cron carries its own CRON_SECRET gate. It is
  // exempt from the session gate for POST only — the GET health check
  // stays behind the session.
  if (normalized === '/api/integrations/order-confirmation/cron' && method === 'POST') {
    return true
  }
  // The read-only external API and the MCP server carry their OWN gate: an
  // API key (REPORTS_API_KEY). They are read-only by construction — there is
  // no write tool and no write route under /api/v1. The session gate must
  // not apply here, otherwise a key-based client could never authenticate.
  if (normalized === '/api/mcp') return true
  // The snapshot cron carries its own CRON_SECRET gate (POST only).
  if (normalized === '/api/cron/report-snapshot' && method === 'POST') return true
  if (normalized.startsWith('/api/v1/')) return true
  if (publicRoutes.includes(normalized)) return true
  return publicPrefixes.some(prefix => normalized.startsWith(prefix))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Apply rate limiting to API routes
  if (pathname.startsWith('/api/')) {
    const config = getRateLimitConfig(pathname, request.method)
    const key = getRateLimitKey(request, 'ratelimit')
    const result = checkRateLimit(key, config)

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit exceeded. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
            'X-RateLimit-Limit': config.requests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
          }
        }
      )
    }
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Read the session from cookies WITHOUT triggering a server-side refresh.
  //
  // IMPORTANT: do NOT call getUser()/refresh here. The server and the browser
  // client would race on the same single-use refresh token; the loser deletes
  // the session cookies and the user gets randomly logged out. The browser
  // client is the single refresher; the middleware only gates routes from the
  // cookie payload. Real verification happens inside API routes (requireUser).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  const hasSession = !!session

  // Protect routes that require authentication
  if (!isPublicRoute(pathname, request.method)) {
    if (!hasSession) {
      // API routes get JSON 401 (never an HTML redirect) so client code can
      // handle them; page routes get a redirect to login.
      if (pathname.startsWith('/api/')) {
        return new NextResponse(
          JSON.stringify({ error: 'Unauthorized', message: 'يجب تسجيل الدخول للمتابعة' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Redirect authenticated users away from auth pages (pages only)
  if (hasSession && (pathname === '/login' || pathname === '/register') && !pathname.startsWith('/api/')) {
    const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard'
    return NextResponse.redirect(new URL(redirectTo, request.url))
  }

  // Add rate limit headers for API routes
  if (pathname.startsWith('/api/')) {
    const config = getRateLimitConfig(pathname, request.method)
    const key = getRateLimitKey(request, 'ratelimit')
    const record = rateLimitStore.get(key)
    if (record) {
      response.headers.set('X-RateLimit-Limit', config.requests.toString())
      response.headers.set('X-RateLimit-Remaining', Math.max(0, config.requests - record.count).toString())
      response.headers.set('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString())
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
