import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Latin digits + Arabic labels — consistent bidi-safe rendering across the app
const NUM_LOCALE = 'ar-EG-u-nu-latn'

/**
 * Money, in the way an Egyptian owner reads it: "40,480 ج.م".
 *
 * `narrowSymbol` renders EGP as "E£", which is neither the symbol Egyptians
 * use nor a code they recognise, so the currency is written explicitly.
 */
export function formatCurrency(amount: number, currency = 'EGP'): string {
  const value = new Intl.NumberFormat(NUM_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
  return currency === 'EGP' ? `${value} ج.م` : `${value} ${currency}`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(NUM_LOCALE).format(value)
}

/**
 * Arabic counted nouns.
 *
 * Arabic changes the noun with the number: 1 منتج · 2 منتجان · 9 منتجات ·
 * 12 منتجاً. Writing "9 منتج" is the kind of small wrongness that makes an
 * otherwise trustworthy screen feel machine-made.
 */
export function arabicCount(
  count: number,
  singular: string,
  plural = `${singular}ات`,
  accusative = `${singular}اً`
): string {
  const n = Math.abs(count)
  if (n === 1) return `${singular} واحد`
  if (n === 2) return `${singular}ان`
  if (n >= 3 && n <= 10) return `${formatNumber(count)} ${plural}`
  return `${formatNumber(count)} ${accusative}`
}

export function formatDate(date: string | Date, locale = NUM_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date, locale = NUM_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('20')) {
    return '+' + cleaned
  }
  if (cleaned.startsWith('0')) {
    return '+20' + cleaned.substring(1)
  }
  if (!cleaned.startsWith('+')) {
    return '+20' + cleaned
  }
  return '+' + cleaned
}

export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  // Egyptian numbers: add +20 prefix if not already present
  if (cleaned.startsWith('20') && cleaned.length === 12) {
    return '+' + cleaned
  }
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return '+20' + cleaned.slice(1)
  }
  if (cleaned.length === 10) {
    return '+20' + cleaned
  }
  // International numbers: add + prefix if not present
  if (!cleaned.startsWith('+')) {
    return '+' + cleaned
  }
  return cleaned
}

/** `customers.phone` is VARCHAR(20) UNIQUE in the database. */
export const MAX_PHONE_LENGTH = 20

/**
 * Fit a string into a VARCHAR column without losing its identity.
 *
 * Several columns are length-limited (products.sku VARCHAR(100),
 * order_items.variant_name VARCHAR(100), customers.name VARCHAR(255) …).
 * An over-long value fails the whole row with 22001, which in the import
 * pipeline means the ORDER is lost. When a value has to be shortened, a
 * short deterministic hash of the original is appended so distinct values
 * stay distinct.
 */
export function fitToColumn(value: string, maxLength: number): string {
  if (!value) return value
  if (value.length <= maxLength) return value
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  const suffix = `-${String(hash % 100000).padStart(5, '0')}`
  return value.slice(0, Math.max(0, maxLength - suffix.length)) + suffix
}

/**
 * Fit a phone number into the `customers.phone` column.
 *
 * A long international number (more than 20 digits after normalisation)
 * overflowed the column, and the 22001 "value too long" error aborted the
 * whole order import — the order was silently lost. The head (country code)
 * and the tail (where two numbers actually differ) are kept; the middle is
 * dropped.
 */
export function normalizePhoneForStorage(phone: string): string {
  const normalized = normalizePhoneNumber(phone)
  if (normalized.length <= MAX_PHONE_LENGTH) return normalized
  const head = normalized.slice(0, 4)
  const tail = normalized.slice(-(MAX_PHONE_LENGTH - head.length))
  return head + tail
}

export function generateOrderNumber(): string {
  const now = new Date()
  const year = now.getFullYear().toString().slice(-2)
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return "ORD-" + year + month + day + "-" + random
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export * from './date-presets'

export const statusColors: Record<string, { bg: string; text: string; icon: string; iconColor: string }> = {
  pending: { bg: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", text: "قيد الانتظار", icon: "⏰", iconColor: "text-yellow-500" },
  awaiting_confirmation: { bg: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", text: "بانتظار التأكيد", icon: "⏰", iconColor: "text-orange-500" },
  confirmed: { bg: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", text: "مؤكد", icon: "📦", iconColor: "text-blue-500" },
  preparing: { bg: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", text: "قيد التجهيز", icon: "📦", iconColor: "text-purple-500" },
  ready_for_shipping: { bg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200", text: "جاهز للشحن", icon: "📦", iconColor: "text-indigo-500" },
  shipped: { bg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200", text: "تم الشحن", icon: "📦", iconColor: "text-cyan-500" },
  out_for_delivery: { bg: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", text: "قيد التوصيل", icon: "📦", iconColor: "text-teal-500" },
  delivered: { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", text: "تم التسليم", icon: "📦", iconColor: "text-emerald-500" },
  cancelled: { bg: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", text: "ملغي", icon: "⚠️", iconColor: "text-red-500" },
  returned: { bg: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200", text: "مرتجع", icon: "⚠️", iconColor: "text-gray-500" },
  failed_delivery: { bg: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", text: "فشل التوصيل", icon: "⚠️", iconColor: "text-red-500" },
}

