#!/usr/bin/env node
/**
 * DEPRECATED — use `node scripts/apply-migrations.mjs` instead.
 *
 * WHAT THIS USED TO DO
 * --------------------
 * It executed every migration statement through a PostgREST RPC named
 * `exec_sql`. That RPC does not exist in this project — which is the correct
 * state of affairs, and must stay that way.
 *
 * WHY
 * ---
 * An `exec_sql(sql text)` helper marked SECURITY DEFINER and granted to
 * `anon` lets ANYONE holding the PUBLIC anon key (which ships in the
 * browser bundle) run arbitrary SQL as the function owner: read every
 * customer record, mint a service-role JWT, or drop the database. One paste
 * into the SQL Editor would have handed the whole project to the open web.
 *
 * The script also swallowed every error and then printed
 * "All migrations completed!" — a false success signal for migrations that
 * never ran.
 *
 * The supported path applies migrations through the Supabase Management API
 * or the Supabase CLI, both of which require a real owner credential, or it
 * prints a paste-ready bundle for the SQL Editor. This shim delegates to it.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'scripts', 'apply-migrations.mjs'), ...process.argv.slice(2)],
  { stdio: 'inherit' }
)

process.exit(result.status ?? 1)
