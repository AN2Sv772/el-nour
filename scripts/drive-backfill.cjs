#!/usr/bin/env node
/**
 * Drives the production EasyOrders backfill to completion.
 *
 * The server-side self-chaining (`after()`) is not reliable on Vercel Hobby,
 * so this loop POSTs the queue processor repeatedly until the backfill
 * reports done. Each POST advances one batch (15 short_ids) and the local
 * loop simply resumes whenever the chain stalls.
 *
 * Auth: this driver runs OUTSIDE Vercel, so it cannot mint the internal
 * trigger secret (it is derived from a write-only server key). It
 * authenticates as the admin user with the Supabase session cookie instead.
 */
const fs = require('fs')
const { q } = require('./prod-query.cjs')

const APP = 'https://el-nour-dashboard.vercel.app'
const MAX_MINUTES = Number(process.argv[2] || 75)
const COOKIE_FILE = '/tmp/admin_cookie.txt'

function adminCookie() {
  try {
    const raw = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

async function status() {
  // Transient network errors must not kill the driver — retry a few times.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await q('easyorders_config?select=backfill_status,backfill_cursor,backfill_max_id,backfill_imported,backfill_skipped,backfill_failed,backfill_last_error')
      if (r.json && r.json[0]) return r.json[0]
    } catch (e) {
      if (attempt === 4) throw e
      await new Promise(r2 => setTimeout(r2, 1000 * attempt))
    }
  }
  return null
}

async function kick() {
  const cookie = adminCookie()
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  try {
    const res = await fetch(`${APP}/api/integrations/easyorders/process-queue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(120_000),
    })
    const t = await res.text()
    let b = null; try { b = JSON.parse(t) } catch { b = t }
    return { status: res.status, body: b }
  } catch (e) {
    return { status: 0, body: { error: String(e.message || e) } }
  }
}

async function main() {
  const started = Date.now()
  let lastCursor = -1
  let stalls = 0

  while ((Date.now() - started) / 60000 < MAX_MINUTES) {
    const before = await status()
    if (!before) { console.log('could not read status'); break }

    if (before.backfill_status === 'done') {
      console.log(`DONE cursor=${before.backfill_cursor}/${before.backfill_max_id} imported=${before.backfill_imported} skipped=${before.backfill_skipped} failed=${before.backfill_failed}`)
      break
    }

    const r = await kick()
    let after = null
    try {
      after = await status()
    } catch {
      console.log('    (status read failed — retrying next iteration)')
      continue
    }
    if (!after) { console.log('could not read status'); break }

    const pct = after.backfill_max_id
      ? ((after.backfill_cursor / after.backfill_max_id) * 100).toFixed(1)
      : '?'
    const bf = r.body?.backfill
    console.log(
      `${new Date().toISOString().slice(11, 19)} | http ${r.status} | ${after.backfill_status} ` +
      `| cursor ${after.backfill_cursor}/${after.backfill_max_id} (${pct}%) ` +
      `| imported ${after.backfill_imported} skipped ${after.backfill_skipped} failed ${after.backfill_failed}` +
      (bf?.error ? ` | batch-error: ${String(bf.error).slice(0, 120)}` : '')
    )
    if (after.backfill_last_error) {
      console.log('    last_error:', String(after.backfill_last_error).slice(0, 220))
    }

    if (after.backfill_cursor === lastCursor) {
      stalls++
      if (stalls >= 3) {
        console.log('    (no progress — waiting 20s)')
        await new Promise(r2 => setTimeout(r2, 20_000))
      }
    } else {
      stalls = 0
    }
    lastCursor = after.backfill_cursor
  }

  const final = await status()
  console.log('\nFINAL:', JSON.stringify(final))
}

main().catch(e => { console.error('DRIVER FAILED:', e); process.exit(1) })
