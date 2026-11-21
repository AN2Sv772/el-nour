export type OrderStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_shipping'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'failed_delivery'

export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded' | 'failed'

export type PaymentMethod = 'cash_on_delivery' | 'card' | 'bank_transfer' | 'wallet' | 'other'

export type MessageDirection = 'inbound' | 'outbound'
export type MessageType = 'text' | 'template' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts'
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface Customer {
  id: string
  phone: string
  name: string | null
  email: string | null
  address: string | null
  governorate: string | null
  city: string | null
  tags: string[]
  notes: string | null
  total_spent: number
  total_orders: number
  last_interaction_at: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  sku: string
  name: string
  name_ar: string | null
  description: string | null
  description_ar: string | null
  category: string | null
  price: number
  compare_at_price: number | null
  cost_price: number | null
  stock_quantity: number
  low_stock_threshold: number
  track_inventory: boolean
  variants: ProductVariant[]
  images: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductVariant {
  id: string
  name: string
  sku: string
  price: number
  stock_quantity: number
  attributes: Record<string, string>
}

export interface Order {
  id: string
  order_number: string
  customer_id: string
  customer?: Customer
  status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod
  subtotal: number
  discount_amount: number
  shipping_fee: number
  tax_amount: number
  total_amount: number
  items: OrderItem[]
  shipping_address: ShippingAddress
  billing_address: ShippingAddress | null
  shipping_company: string | null
  tracking_number: string | null
  tracking_url: string | null
  source: string | null
  notes: string | null
  internal_notes: string | null
  assigned_employee_id: string | null
  confirmed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  easyorders_order_id: string | null
  easyorders_store_id: string | null
  easyorders_sync_cursor: string | null
  easyorders_last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product?: Product
  variant_id: string | null
  product_name: string
  product_name_ar: string | null
  sku: string
  variant_name: string | null
  quantity: number
  unit_price: number
  /** Historical unit-cost snapshot captured at order creation/import time */
  unit_cost?: number | null
  discount: number
  total_price: number
}

export interface ShippingAddress {
  name: string
  phone: string
  address: string
  city: string
  governorate: string
  postal_code: string | null
  landmark: string | null
  coordinates: { lat: number; lng: number } | null
}

export interface AutoReplyTemplate {
  id: string
  trigger_keyword: string
  trigger_type: 'exact' | 'contains' | 'regex' | 'intent'
  reply_text: string
  reply_text_ar: string | null
  reply_text_en: string | null
  media_url: string | null
  is_active: boolean
  priority: number
  usage_count: number
  conditions: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface AutomationLog {
  id: string
  type: 'auto_reply' | 'order_created' | 'order_updated' | 'inventory_updated' | 'notification_sent' | 'ai_escalation' | 'webhook_received'
  status: 'success' | 'failed' | 'pending'
  reference_id: string | null
  reference_type: string | null
  details: Record<string, unknown>
  error_message: string | null
  created_at: string
}

export interface InventoryMovement {
  id: string
  product_id: string
  variant_id: string | null
  type: 'in' | 'out' | 'adjustment' | 'reserved' | 'released'
  quantity: number
  reference_id: string | null
  reference_type: 'order' | 'purchase' | 'return' | 'adjustment' | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'manager' | 'employee' | 'viewer'
  avatar_url: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrderStatusHistory {
  id: string
  order_id: string
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_by: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: 'new_order' | 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'order_cancelled' | 'low_stock' | 'failed_delivery' | 'ai_escalation' | 'payment_received' | 'system'
  title: string
  message: string
  reference_id: string | null
  reference_type: string | null
  is_read: boolean
  created_at: string
}

export interface SavedFilter {
  id: string
  user_id: string
  name: string
  entity: 'orders' | 'customers' | 'products' | 'conversations'
  filters: Record<string, unknown>
  is_default: boolean
  created_at: string
}

export interface ExportJob {
  id: string
  user_id: string
  type: 'orders' | 'customers' | 'products' | 'sales' | 'shipping' | 'inventory'
  format: 'xlsx' | 'csv'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  filters: Record<string, unknown>
  columns: string[]
  file_url: string | null
  row_count: number | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface ImportJob {
  id: string
  user_id: string
  type: 'orders' | 'customers' | 'products'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'preview'
  file_url: string
  column_mapping: Record<string, string>
  preview_data: unknown[] | null
  validation_errors: ImportError[] | null
  total_rows: number
  successful_rows: number
  failed_rows: number
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface ImportError {
  row: number
  field: string
  value: unknown
  error: string
}

export interface AIConfig {
  id: string
  system_prompt: string
  system_prompt_ar: string | null
  system_prompt_en: string | null
  max_tokens: number
  temperature: number
  reply_limit_per_conversation: number
  cooldown_minutes: number
  working_hours_start: string
  working_hours_end: string
  working_days: number[]
  escalation_keywords: string[]
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface BusinessSettings {
  id: string
  business_name: string
  business_name_ar: string | null
  business_name_en: string | null
  currency: string
  timezone: string
  default_shipping_fee: number
  free_shipping_threshold: number | null
  tax_rate: number
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
  order_workflow: OrderWorkflowStep[]
  created_at: string
  updated_at: string
}

export interface OrderWorkflowStep {
  id: string
  name: string
  name_ar: string | null
  name_en: string | null
  status: OrderStatus
  requires_confirmation: boolean
  confirmation_message: string | null
  confirmation_message_ar: string | null
  confirmation_message_en: string | null
  auto_advance: boolean
  auto_advance_hours: number | null
}

export interface EasyOrdersConfig {
  id: string
  api_key: string
  store_id: string | null
  store_name: string | null
  webhook_secret: string | null
  webhook_url: string | null
  is_connected: boolean
  last_sync_at: string | null
  last_sync_status: 'success' | 'failed' | 'partial' | null
  last_sync_error: string | null
  last_webhook_at: string | null
  total_imported_orders: number
  total_updated_orders: number
  total_skipped_orders: number
  sync_cursor: string | null
  created_at: string
  updated_at: string
}

export interface EasyOrdersOrder {
  id: string
  updated_at: string
  created_at: string
  store_id: string
  cost: number
  shipping_cost: number
  total_cost: number
  status: string
  full_name: string
  phone: string
  government: string
  address: string
  payment_method: string
  cart_items: EasyOrdersCartItem[]
}

export interface EasyOrdersCartItem {
  id: string
  product_id: string
  variant_id: string | null
  store_id: string
  price: number
  quantity: number
  product: EasyOrdersProduct
  variant: EasyOrdersVariant | null
}

export interface EasyOrdersProduct {
  id: string
  updated_at: string
  created_at: string
  store_id: string
  name: string
  price: number
  sku: string
  taager_code: string | null
  drop_shipping_provider: string | null
  variant: EasyOrdersVariant | null
}

export interface EasyOrdersVariant {
  id: string
  product_id: string
  price: number
  sale_price: number
  quantity: number
  taager_code: string | null
  variation_props: EasyOrdersVariationProp[]
}

export interface EasyOrdersVariationProp {
  id: string
  variation: string
  variation_prop: string
  product_variant_id: string
}

export interface EasyOrdersWebhookPayload {
  id: string
  updated_at: string
  created_at: string
  store_id: string
  cost: number
  shipping_cost: number
  total_cost: number
  status: string
  full_name: string
  phone: string
  government: string
  address: string
  payment_method: string
  cart_items: EasyOrdersCartItem[]
}

export interface EasyOrdersStatusChangePayload {
  event_type: 'order-status-update'
  order_id: string
  old_status: string
  new_status: string
  payment_ref_id: string | null
}

export type EasyOrdersWebhookEventType = 'order-created' | 'order-status-update'

export interface EasyOrdersSyncJob {
  id: string
  config_id: string
  type: 'full_import' | 'incremental_sync' | 'webhook_processing'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
  started_at: string
  completed_at: string | null
  orders_processed: number
  orders_imported: number
  orders_updated: number
  orders_skipped: number
  errors: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface EasyOrdersWebhookEvent {
  id: string
  config_id: string
  event_type: EasyOrdersWebhookEventType
  payload: Record<string, unknown>
  processed: boolean
  processed_at: string | null
  error_message: string | null
  created_at: string
}

export interface EasyOrdersSyncStats {
  total_imported: number
  total_updated: number
  total_skipped: number
  last_sync_at: string | null
  last_sync_status: 'success' | 'failed' | 'partial' | null
  last_error: string | null
  errors: string[]
}

export type Language = 'ar' | 'en' | 'ar-EG'

export interface DashboardStats {
  total_orders: number
  today_orders: number
  pending_orders: number
  confirmed_orders: number
  shipped_orders: number
  delivered_orders: number
  cancelled_orders: number
  returned_orders: number
  total_sales: number
  delivered_revenue: number
  outstanding_payments: number
  total_customers: number
  provisional_cogs?: number
  provisional_profit?: number
  expenses_total?: number
  collections_received?: number
  collections_outstanding?: number
  aov?: number
  conversion_rate?: number
}

export interface ChartData {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    backgroundColor?: string | string[]
    borderColor?: string | string[]
  }[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
