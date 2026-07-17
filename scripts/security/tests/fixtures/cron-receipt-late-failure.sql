-- Synthetic integration fixture: this statement must be injected after the
-- full receipt-install template postcondition but before its explicit COMMIT.
DO $late_failure$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'synthetic_late_receipt_install_failure';
END
$late_failure$;
