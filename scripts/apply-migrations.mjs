#!/usr/bin/env node
/**
 * apply-migrations.mjs — apply the pending Supabase migrations to the live
 * project, honestly.
 *
 * Why this script exists: the three pending migrations
 *   20260123000000_business_brain.sql
 *   20260124000000_ai_approvals.sql
 *   20260125000000_report_snapshots.sql
 * are additive-only (CREATE TABLE IF NOT EXISTS / CREATE POLICY after
 * DROP POLICY IF EXISTS / CREATE INDEX IF NOT EXISTS) and they unlock
 * /api/brain/**, /api/ai/approvals and the daily snapshot cron. They still
 * have to be executed against the database, and the machine running this
 * script does not hold credentials for that project — so the script supports
 * three ways and *tells you which one it used*.
 *
 * Usage:
 *   node scripts/apply-migrations.mjs --print     # emit one paste-ready file
 *   node scripts/apply-migrations.mjs              # apply via Management API
 *
 * Modes (auto-detected, in this order):
 *   1. Management API  — needs SUPABASE_ACCESS_TOKEN (personal access token)
 *      https://api.supabase.com/v1/projects/<ref>/database/query
 *   2. Supabase CLI   — needs the CLI logged in with access to <ref>
 *      (supabase link --project-ref <ref> && supabase db push --include-all)
 *   3. Print          — no credentials: writes supabase/pending-migrations.sql
 *      and prints the exact Supabase SQL Editor steps.
 *
 * Environment:
 *   SUPABASE_PROJECT_REF   default: lyswmlmrlviptprhfiph
 *   SUPABASE_ACCESS_TOKEN  personal access token (mode 1)
 *   SUPABASE_DB_PASSWORD   database password (mode 2, CLI link)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'lyswmlmrlviptprhfiph'

/**
 * The SQL that still has to reach the database, in the order it must run.
 *
 * The first entry is a RE-APPLY: `20240110000000_auth_user_profile_trigger.sql`
 * is already recorded as applied, so `supabase db push` would skip it — but
 * the trigger it creates has since been changed to mint an inactive `viewer`
 * instead of an active `employee`. The SQL Editor has no migration history,
 * so the paste-ready bundle includes it.
 *
 * `20260122000000_easyorders_atomic_sync_log.sql` was found NOT to be applied
 * to the live project by the object-level inventory on 2026-11-22: neither
 * `increment_easyorders_counters` nor `record_easyorders_sync_run` existed,
 * and `easyorders_sync_logs.sync_type` still carried the original
 * `('manual','webhook','scheduled','retry')` constraint — so the scanner run
 * types ('backfill', 'catch-up') were still being rejected by the database.
 * That is finding F-012 (lost counter updates) and F-013 (no audit trail for
 * the scanners), and it is the reason this file is in the list.
 *
 * NOTE: the live project has NO `supabase_migrations.schema_migrations`
 * ledger — every migration so far was applied through the SQL Editor, so
 * there is no history to consult. "Is it applied?" is therefore answered by
 * checking whether the objects a migration creates actually exist.
 */
const PENDING = [
  '20240110000000_auth_user_profile_trigger.sql',
  '20260122000000_easyorders_atomic_sync_log.sql',
  '20260123000000_business_brain.sql',
  '20260124000000_ai_approvals.sql',
  '20260125000000_report_snapshots.sql',
  '20260126000000_lock_user_profile_role.sql',
  '20260127000000_grant_brain_approvals_snapshots.sql',
  '20260128000000_replace_jwt_user_metadata_role_checks.sql',
  '20260129000000_scope_system_insert_policies.sql',
]

/** Tables each migration creates — used to verify the result. */
const EXPECTED_TABLES = {
  '20260123000000_business_brain.sql': [
    'business_profile',
    'business_knowledge',
    'business_knowledge_sources',
    'business_goals',
    'business_rules',
    'business_brain_questions',
    'business_brain_runs',
  ],
  '20260124000000_ai_approvals.sql': ['ai_approvals', 'ai_execution_logs'],
  '20260125000000_report_snapshots.sql': ['report_snapshots'],
}

/**
 * Functions each migration creates — the real "was it applied?" probe, because
 * the live project keeps no migration ledger.
 */
const EXPECTED_FUNCTIONS = {
  '20260122000000_easyorders_atomic_sync_log.sql': [
    'increment_easyorders_counters',
    'record_easyorders_sync_run',
  ],
}

async function readMigration(name) {
  const file = path.join(MIGRATIONS_DIR, name)
  if (!existsSync(file)) throw new Error(`Migration not found: ${file}`)
  return readFile(file, 'utf8')
}

/* ------------------------------------------------------------------ */
/* Mode 1 — Supabase Management API                                     */
/* ------------------------------------------------------------------ */

async function applyViaManagementApi(token) {
  const endpoint = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  const results = []
  for (const name of PENDING) {
    const sql = await readMigration(name)
    process.stdout.write(`→ ${name} … `)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.log('FAILED')
      console.error(text.slice(0, 800))
      results.push({ name, ok: false, error: text.slice(0, 200) })
      continue
    }
    console.log('applied')
    results.push({ name, ok: true })
  }
  return results
}

/* ------------------------------------------------------------------ */
/* Mode 2 — Supabase CLI                                                */
/* ------------------------------------------------------------------ */

async function applyViaCli() {
  const { spawn } = await import('node:child_process')
  const run = (cmd, args) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' })
      child.on('close', (code) => resolve(code ?? 1))
    })

  console.log('→ linking the project with the Supabase CLI…')
  const link = await run('supabase', ['link', '--project-ref', PROJECT_REF])
  if (link !== 0) {
    console.error('✗ supabase link failed — run `supabase login` and retry, or use --print.')
    return null
  }
  console.log('→ pushing the migrations…')
  const push = await run('supabase', ['db', 'push', '--include-all'])
  if (push !== 0) {
    console.error('✗ supabase db push failed — use --print and paste the SQL manually.')
    return null
  }
  return PENDING.map((name) => ({ name, ok: true }))
}

/* ------------------------------------------------------------------ */
/* Mode 3 — print a paste-ready bundle                                  */
/* ------------------------------------------------------------------ */

async function printBundle() {
  const parts = []
  for (const name of PENDING) {
    parts.push(
      `\n-- ══════════════════════════════════════════════════════════════\n-- ${name}\n-- ══════════════════════════════════════════════════════════════\n`,
      await readMigration(name),
    )
  }
  const bundle = [
    '-- El Nour Dashboard — pending migrations (additive only)',
    `-- Project: ${PROJECT_REF}`,
    `-- Generated: ${new Date().toISOString()}`,
    '-- Safe to run twice: every statement is IF NOT EXISTS / DROP POLICY IF EXISTS.',
    '',
    ...parts,
  ].join('\n')

  const outDir = path.join(ROOT, 'supabase')
  await mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, 'pending-migrations.sql')
  await writeFile(outFile, bundle, 'utf8')

  console.log(`✓ wrote ${outFile} (${bundle.length} chars)`)
  console.log('')
  console.log('Apply it with ONE of these:')
  console.log(`  1. Supabase SQL Editor — open https://supabase.com/dashboard/project/${PROJECT_REF}/sql/editor`)
  console.log('     → paste the whole file → click Run. The editor accepts multiple statements.')
  console.log(`  2. Management API — node scripts/apply-migrations.mjs   (needs SUPABASE_ACCESS_TOKEN)`)
  console.log(`  3. CLI — supabase link --project-ref ${PROJECT_REF} && supabase db push --include-all`)
  console.log('')
  console.log('Then verify:')
  console.log('  curl -s -H "Authorization: Bearer $SERVICE_ROLE" \\')
  console.log(`    "${process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://' + PROJECT_REF + '.supabase.co'}/rest/v1/business_profile?select=id&limit=1"`)
  return []
}

/* ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--print')) {
    await printBundle()
    return
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (token) {
    console.log(`Mode 1 — Management API (project ${PROJECT_REF})`)
    const results = await applyViaManagementApi(token)
    report(results)
    return
  }

  console.log('Mode 2 — Supabase CLI')
  const cliResults = await applyViaCli()
  if (cliResults) {
    report(cliResults)
    return
  }

  console.log('')
  console.log('Mode 3 — no usable credentials, falling back to the paste-ready bundle')
  await printBundle()
}

function report(results) {
  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`✓ ${results.length - failed.length}/${results.length} migrations applied`)
  if (failed.length) {
    console.log('✗ failed:', failed.map((f) => f.name).join(', '))
    process.exitCode = 1
    return
  }
  console.log('')
  console.log('Verify the tables now exist, then check the endpoints:')
  console.log('  GET  /api/brain/status      → should report available: true')
  console.log('  GET  /api/ai/approvals      → should be 200 (not 503)')
  console.log('  POST /api/cron/report-snapshot → should store yesterday\'s snapshot')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
