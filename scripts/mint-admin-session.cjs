#!/usr/bin/env node
/**
 * Mint an admin session for local API testing.
 *
 * The dashboard's `requireUser()` reads the session from the COOKIE, not from
 * an `Authorization` header, and the browser cookie must be the
 * `base64-<base64(JSON session)>` envelope that @supabase/ssr writes — a bare
 * access token makes the API answer 307 (redirect) instead of 200.
 *
 * Usage:
 *   node scripts/mint-admin-session.cjs            # writes /tmp/admin_cookie.txt
 *   node scripts/mint-admin-session.cjs --print    # also prints the token
 *
 * Uses the SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

function loadEnv() {
  const file = path.join(ROOT, '.env.local')
  const env = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i === -1) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const email = env.ADMIN_EMAIL || process.argv.find((a) => a.includes('@')) || 'an2s.q.11@gmail.com'

  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
    process.exit(1)
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  }

  // 1) generate a one-time link. The response is FLAT: hashed_token is at the
  //    top level, not nested under properties.
  const gen = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const genBody = await gen.json().catch(() => ({}))
  const hashed = genBody.hashed_token || genBody.properties?.hashed_token
  if (!hashed) {
    console.error('generate_link failed:', gen.status, JSON.stringify(genBody).slice(0, 300))
    process.exit(1)
  }

  // 2) verify. Only `type` and `token_hash` are accepted — sending
  //    `redirect_to` as well makes the endpoint answer 400.
  const verify = await fetch(`${url}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: serviceKey },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  })
  const session = await verify.json().catch(() => ({}))
  if (!session.access_token) {
    console.error('verify failed:', verify.status, JSON.stringify(session).slice(0, 300))
    process.exit(1)
  }

  // The cookie envelope MUST be base64URL, not standard base64.
  //
  // @supabase/ssr 0.12.x decodes the value with `stringFromBase64URL()`, which
  // understands only the URL-safe alphabet (`-` and `_`). A standard base64
  // payload that contains `+`, `/` or `=` padding decodes to garbage, the SDK
  // treats the cookie as absent, and every route answers 401 with a perfectly
  // valid access token in hand.
  const envelope = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const cookieName = `sb-${url.split('//')[1].split('.')[0]}-auth-token`
  const cookiePair = `${cookieName}=${envelope}`

  fs.writeFileSync('/tmp/admin_cookie.txt', cookiePair)
  fs.writeFileSync('/tmp/admin_access_token.txt', session.access_token)
  fs.writeFileSync(
    '/tmp/cookie-pair.json',
    JSON.stringify({ name: cookieName, value: envelope }, null, 2)
  )

  console.log('session minted')
  console.log('  user     :', session.user?.email, '| role:', session.user?.role)
  console.log('  expires  :', new Date(session.expires_at * 1000).toISOString())
  console.log('  cookie   : /tmp/admin_cookie.txt  (/tmp/cookie-pair.json)')
  console.log('  token    : /tmp/admin_access_token.txt')
  if (process.argv.includes('--print')) console.log('  token val:', session.access_token)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
