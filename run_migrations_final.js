#!/usr/bin/env node
/**
 * DEPRECATED — use `node scripts/apply-migrations.mjs` instead.
 *
 * WHAT THIS USED TO CARRY
 * -----------------------
 * A template for creating an `exec_sql(sql text)` helper:
 *
 *     CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void
 *     LANGUAGE plpgsql SECURITY DEFINER ...
 *     GRANT EXECUTE ON FUNCTION exec_sql(text) TO postgres, anon, authenticated, service_role;
 *
 * The template was never executed — the REST API cannot run raw DDL — but it
 * was a loaded gun sitting in the repository root: one paste into the
 * Supabase SQL Editor would have created a function that lets ANYONE holding
 * the PUBLIC anon key run arbitrary SQL as the function owner. The anon key
 * ships in the browser bundle, so that is a full database takeover reachable
 * from a browser by anyone who opened the dev tools.
 *
 * The template has been removed. The supported path applies migrations
 * through the Supabase Management API or the Supabase CLI — both of which
 * require a real owner credential — or prints a paste-ready bundle for the
 * SQL Editor. This shim delegates to it.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'scripts', 'apply-migrations.mjs'), ...process.argv.slice(2)],
  { stdio: 'inherit' }
)

process.exit(result.status ?? 1)
