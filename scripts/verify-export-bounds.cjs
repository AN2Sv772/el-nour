#!/usr/bin/env node
/**
 * F-017 verification — the export and the orders list must select the SAME
 * orders for the same date filter.
 *
 * BEFORE the fix, the export compared the raw strings
 * (`2026-11-01` → `2026-11-01T00:00:00Z`) while the list used the Cairo day
 * boundaries (`2026-10-31T22:00:00Z` …), so three orders created in the
 * first two hours of 2026-11-01 Cairo time were missing from the export:
 *   EO-261111-7913, EO-261111-1935, EO-261111-9264
 *
 * The probe compares the order numbers of both answers, row by row.
 *
 * Usage: node scripts/verify-export-bounds.cjs [baseUrl]
 */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const BASE = process.argv[2] || 'http://localhost:3111'
const COOKIE_FILE = '/tmp/admin_cookie.txt'

function loadCookie() {
  if (!fs.existsSync(COOKIE_FILE)) throw new Error('missing ' + COOKIE_FILE)
  return fs.readFileSync(COOKIE_FILE, 'utf8').trim()
}

async function getJson(url, cookie) {
  const res = await fetch(url, { headers: { Cookie: cookie } })
  const body = await res.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* keep null */ }
  return { status: res.status, json }
}

async function postExport(body, cookie) {
  const res = await fetch(BASE + '/api/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buf }
}

function xlsxOrderNumbers(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  // Column 0 is "رقم الطلب"; skip the header row.
  return rows.slice(1).map(r => String(r[0] || '').trim()).filter(Boolean)
}

async function main() {
  const cookie = loadCookie()
  const ranges = [
    { dateFrom: '2026-11-01', dateTo: '2026-11-21' },
    { dateFrom: '2026-10-01', dateTo: '2026-11-21' },
    { dateFrom: '2026-11-19', dateTo: '2026-11-21' },
  ]
  const out = { base: BASE, generated_at: new Date().toISOString(), ranges: [] }

  for (const range of ranges) {
    // The list API caps a page at 200 rows, so page through it.
    const listNumbers = []
    let listStatus = 0
    let page = 1
    let listTotal = null
    for (;;) {
      const qs = new URLSearchParams({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        page: String(page),
        pageSize: '200',
      })
      const list = await getJson(BASE + '/api/orders?' + qs.toString(), cookie)
      listStatus = list.status
      const rows = list.json?.data || []
      listTotal = list.json?.total ?? listTotal
      for (const o of rows) listNumbers.push(String(o.order_number || '').trim())
      if (rows.length < 200 || listNumbers.length >= (listTotal || 0)) break
      page += 1
      if (page > 50) break
    }

    const exp = await postExport({ type: 'orders', filters: range, format: 'xlsx' }, cookie)
    let exportNumbers = []
    let exportRows = 0
    if (exp.status === 200) {
      exportNumbers = xlsxOrderNumbers(exp.buf)
      exportRows = exportNumbers.length
    }

    const missing = listNumbers.filter(n => !exportNumbers.includes(n))
    const extra = exportNumbers.filter(n => !listNumbers.includes(n))

    out.ranges.push({
      filter: range,
      list_status: listStatus,
      list_rows: listNumbers.length,
      list_total: listTotal,
      export_status: exp.status,
      export_rows: exportRows,
      export_bytes: exp.buf.length,
      missing_from_export: missing,
      extra_in_export: extra,
      identical: missing.length === 0 && extra.length === 0,
    })
  }

  // Fail-closed check: an unparseable bound must be rejected, not ignored.
  const bad = await postExport(
    { type: 'orders', filters: { dateFrom: 'not-a-date', dateTo: '2026-11-21' }, format: 'xlsx' },
    cookie
  )
  out.invalid_date_filter = { status: bad.status, body: bad.buf.toString('utf8').slice(0, 120) }

  fs.writeFileSync(
    path.join(__dirname, '..', 'audit', 'evidence', 'export_bounds_probe.json'),
    JSON.stringify(out, null, 2)
  )
  console.log(JSON.stringify(out, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
