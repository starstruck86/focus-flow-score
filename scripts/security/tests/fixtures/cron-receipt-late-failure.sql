-- Synthetic integration fixture: this statement must execute after the full
-- receipt migration but before its single-transaction commit.
DO $late_failure$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'synthetic_late_receipt_migration_failure';
END
$late_failure$;
