#!/usr/bin/env node
/**
 * F-012 / F-013 verification against the live database (READ-ONLY apart
 * from the counters the code itself owns).
 *
 * It proves three things:
 *
 *  1) F-012 — the counter on `easyorders_config` is far behind the number
 *     of successful imports in `automation_logs` (the lost-update damage).
 *  2) F-013 — `easyorders_sync_logs` has no row for the scanners that did
 *     the importing (the missing audit trail).
 *  3) The new SQL functions are NOT on the database yet, so the code must
 *     still work through its fallback path (deploy order does not matter).
 *
 * Usage: node scripts/verify-sync-counters.cjs
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

function loadEnv() {
  const env = {}
  const file = path.join(ROOT, '.env.local')
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[t.slice(0, i).trim()] = v
  }
  return env
}

const env = loadEnv()
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY

async function rest(pathname, extraHeaders = {}) {
  const res = await fetch(URL + '/rest/v1/' + pathname, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, ...extraHeaders },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep null */ }
  return { status: res.status, json, headers: res.headers }
}

async function main() {
  const out = { generated_at: new Date().toISOString(), project: URL }

  // 1) the counter vs the real import count
  const cfg = await rest('easyorders_config?select=total_imported_orders,total_updated_orders,total_skipped_orders,last_sync_at,last_webhook_at,backfill_imported,backfill_skipped&limit=1')
  // `automation_logs` uses `type`, not `event_type`.
  const countRes = await rest('automation_logs?select=id&type=eq.order_created&status=eq.success', {
    Prefer: 'count=exact', Range: '0-0',
  })
  const webhookCount = await rest('automation_logs?select=id&type=eq.webhook_received', {
    Prefer: 'count=exact', Range: '0-0',
  })
  const latest = await rest('automation_logs?select=id,created_at&type=eq.order_created&status=eq.success&order=created_at.desc&limit=1')
  const syncLogs = await rest('easyorders_sync_logs?select=id,sync_type,status,orders_imported,orders_skipped,created_at&order=created_at.desc&limit=20')

  out.config = Array.isArray(cfg.json) ? cfg.json[0] : cfg.json
  out.successful_imports = {
    count_content_range: countRes.headers ? countRes.headers.get('content-range') : null,
    webhook_received_content_range: webhookCount.headers ? webhookCount.headers.get('content-range') : null,
    latest_import: Array.isArray(latest.json) ? latest.json[0] : null,
  }
  // The gap the counter can never show: imported rows vs the counter.
  const importedCount = Number((countRes.headers?.get('content-range') || '').split('/')[1] || 0)
  const counter = out.config?.total_imported_orders ?? 0
  out.f012_gap = {
    counter_total_imported_orders: counter,
    successful_imports_in_automation_logs: importedCount,
    missing_updates: importedCount - counter,
  }
  out.sync_logs = {
    rows_returned: Array.isArray(syncLogs.json) ? syncLogs.json.length : null,
    rows: syncLogs.json,
  }

  // 2) are the new SQL functions present? (the code must not depend on it)
  const fn = await rest('rpc/' + encodeURIComponent('increment_easyorders_counters') + '?select=')
  out.functions = {
    increment_easyorders_counters: { status: fn.status, body: (fn.json?.message || fn.json?.hint || '').toString().slice(0, 120) },
  }

  fs.writeFileSync(
    path.join(ROOT, 'audit', 'evidence', 'sync_counters_probe.json'),
    JSON.stringify(out, null, 2)
  )
  console.log(JSON.stringify(out, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
