import { NextResponse } from 'next/server'

/**
 * A missing table is the most common operational failure in this project:
 * three additive migrations are written but not applied to production yet.
 *
 * The rule from the product brief: when something is missing, NAME it and
 * say how to obtain it. A raw PostgREST message ("Could not find the table
 * 'public.ai_approvals' in the schema cache") tells the owner nothing about
 * what to do next.
 *
 * This helper turns that into an actionable 503:
 *   - the human error (Arabic),
 *   - the exact migration file to run,
 *   - the two ways to run it,
 *   - the raw driver message under `detail` for the logs.
 */

const MIGRATION_HINT =
  'شغّل الـ migration على Supabase: افتح SQL Editor والصق محتوى الملف، أو شغّل `node scripts/apply-migrations.mjs` بعد ضبط SUPABASE_ACCESS_TOKEN.'

const MISSING_TABLE_PATTERN = /Could not find the table|does not exist|schema cache/i

export function isMissingTableError(message: string | undefined | null): boolean {
  return Boolean(message && MISSING_TABLE_PATTERN.test(message))
}

/**
 * @param errorMessage the raw error text from the driver
 * @param migrationFile the repository-relative migration file that creates the table
 * @param table the table name, for the message
 */
export function missingTableResponse(
  errorMessage: string | undefined | null,
  migrationFile: string,
  table: string
): NextResponse {
  return NextResponse.json(
    {
      available: false,
      error: `جدول ${table} غير موجود في الإنتاج — لم يُطبَّق الـ migration بعد.`,
      migration: migrationFile,
      how_to_apply: MIGRATION_HINT,
      detail: errorMessage ?? null,
    },
    { status: 503 }
  )
}
