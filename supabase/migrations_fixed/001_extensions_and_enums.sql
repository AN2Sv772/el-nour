-- ============================================================================
-- MIGRATION 001: Extensions and Enum Types
-- Description: Core extensions and enum type definitions
-- Dependencies: None
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom enum types
CREATE TYPE order_status AS ENUM (
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'ready_for_shipping',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'failed_delivery'
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'paid',
  'partial',
  'refunded',
  'failed'
);

CREATE TYPE payment_method AS ENUM (
  'cash_on_delivery',
  'card',
  'bank_transfer',
  'wallet',
  'other'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_type AS ENUM ('text', 'template', 'image', 'document', 'audio', 'video', 'location', 'contacts');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed', 'received');
CREATE TYPE conversation_status AS ENUM ('open', 'closed', 'pending', 'escalated');
CREATE TYPE automation_type AS ENUM ('auto_reply', 'order_created', 'order_updated', 'inventory_updated', 'notification_sent', 'ai_escalation', 'webhook_received');
CREATE TYPE automation_status AS ENUM ('success', 'failed', 'pending');
CREATE TYPE inventory_movement_type AS ENUM ('in', 'out', 'adjustment', 'reserved', 'released');
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee', 'viewer');
CREATE TYPE notification_type AS ENUM ('new_order', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'low_stock', 'failed_delivery', 'ai_escalation', 'payment_received', 'system');
CREATE TYPE export_job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE export_format AS ENUM ('xlsx', 'csv');
CREATE TYPE import_job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'preview');
CREATE TYPE inventory_movement_type AS ENUM ('in', 'out', 'adjustment', 'reserved', 'released');
