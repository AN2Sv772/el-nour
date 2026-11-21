/**
 * Convenience re-exports so webhook route imports stay tidy.
 * (keeps a single import site for both service + sync singletons)
 */
export { easyOrdersService } from '@/lib/easyorders/service'
export { easyOrdersSyncService } from '@/lib/easyorders/sync'
