/**
 * CSV export.
 *
 * Two details matter for an Arabic business file:
 *   1. the UTF-8 BOM — without it Excel on Windows opens the file as garbage;
 *   2. the escaping — a product name with a comma or a quote must not break
 *      the row.
 */

export interface CsvColumn<T> {
  key: string
  header: string
  value: (row: T) => string | number | null | undefined
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Build a CSV document from rows and a column definition. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCell(c.header)).join(',')
  const body = rows.map(row => columns.map(c => escapeCell(c.value(row))).join(','))
  return [header, ...body].join('\r\n')
}

/** The response body for a CSV download. */
export function csvResponse<T>(rows: T[], columns: CsvColumn<T>[], filename: string): Response {
  const csv = toCsv(rows, columns)
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
