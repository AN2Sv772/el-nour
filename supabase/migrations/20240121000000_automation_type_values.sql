-- Extend automation_type with webhook lifecycle values used by diagnostics
ALTER TYPE automation_type ADD VALUE IF NOT EXISTS 'webhook_attempt';
ALTER TYPE automation_type ADD VALUE IF NOT EXISTS 'webhook_rejected';
ALTER TYPE automation_type ADD VALUE IF NOT EXISTS 'webhook_processed';
ALTER TYPE automation_type ADD VALUE IF NOT EXISTS 'webhook_failed';
ALTER TYPE automation_type ADD VALUE IF NOT EXISTS 'webhook_enqueue_failed';
