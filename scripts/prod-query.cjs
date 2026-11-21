// Production evidence gatherer — READ-ONLY. Prints no secret values.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function q(path, { method = 'GET', headers = {}, body, range } = {}) {
  const h = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...headers,
  }
  if (range) h.Range = range
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, contentRange: res.headers.get('content-range') }
}

function countOf(cr) {
  if (!cr) return null
  const m = cr.match(/\/(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

module.exports = { q, countOf, SB, KEY }
